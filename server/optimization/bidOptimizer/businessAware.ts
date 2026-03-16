/**
 * 业务感知调整 — ASP变动感知、库存保护、自然排名策略
 * v417: 从 bidOptimizer.ts 拆分
 */

import {
  type OptimizationTarget,
  type ASPSensitivityResult,
  type InventoryProtectionResult,
  type OrganicRankStrategyResult,
  ASP_SENSITIVITY_CONFIG,
  INVENTORY_PROTECTION_CONFIG,
} from './types';

/**
 * 计算ASP变动感知
 */
export function calculateASPSensitivity(
  currentASP: number | undefined,
  historicalASP: number | undefined
): ASPSensitivityResult {
  if (!currentASP || !historicalASP || historicalASP === 0) {
    return {
      aspChangePercent: 0,
      priceAction: 'stable',
      acosAdjustmentMultiplier: 1,
      reason: '无ASP数据，保持标准ACoS目标',
    };
  }
  
  const aspChangePercent = (currentASP - historicalASP) / historicalASP;
  
  if (aspChangePercent < -ASP_SENSITIVITY_CONFIG.significantDropPercent) {
    return {
      aspChangePercent: Math.round(aspChangePercent * 100) / 100,
      priceAction: 'price_drop',
      acosAdjustmentMultiplier: ASP_SENSITIVITY_CONFIG.acosRelaxMultiplier,
      reason: `检测到降价/秒杀：ASP从$${historicalASP.toFixed(2)}降至$${currentASP.toFixed(2)}(${(aspChangePercent * 100).toFixed(1)}%)，临时放宽 ACoS目标${Math.round((ASP_SENSITIVITY_CONFIG.acosRelaxMultiplier - 1) * 100)}%抓住流量红利`,
    };
  }
  
  if (aspChangePercent > ASP_SENSITIVITY_CONFIG.significantRisePercent) {
    return {
      aspChangePercent: Math.round(aspChangePercent * 100) / 100,
      priceAction: 'price_rise',
      acosAdjustmentMultiplier: ASP_SENSITIVITY_CONFIG.acosStricterMultiplier,
      reason: `检测到涨价：ASP从$${historicalASP.toFixed(2)}升至$${currentASP.toFixed(2)}(+${(aspChangePercent * 100).toFixed(1)}%)，收紧ACoS目标${Math.round((1 - ASP_SENSITIVITY_CONFIG.acosStricterMultiplier) * 100)}%保护利润`,
    };
  }
  
  return {
    aspChangePercent: Math.round(aspChangePercent * 100) / 100,
    priceAction: 'stable',
    acosAdjustmentMultiplier: 1,
    reason: `ASP稳定($${currentASP.toFixed(2)}，变动${(aspChangePercent * 100).toFixed(1)}%)，保持标准ACoS目标`,
  };
}

/**
 * 计算库存保护调整
 */
export function calculateInventoryProtection(
  currentBid: number,
  inventoryLevel: OptimizationTarget['inventoryLevel'],
  inventoryDays?: number
): InventoryProtectionResult {
  const {
    lowInventoryThreshold,
    criticalInventoryThreshold,
    lowInventoryBidMultiplier,
    criticalInventoryBidMultiplier,
    outOfStockBidMultiplier,
  } = INVENTORY_PROTECTION_CONFIG;
  
  if (inventoryLevel === 'out_of_stock') {
    return {
      originalBid: currentBid,
      adjustedBid: 0,
      bidMultiplier: outOfStockBidMultiplier,
      inventoryLevel: 'out_of_stock',
      inventoryDays,
      action: 'pause',
      reason: '库存已缺货，暂停广告投放避免浪费广告费',
    };
  }
  
  if (inventoryLevel === 'critical' || (inventoryDays !== undefined && inventoryDays <= criticalInventoryThreshold)) {
    const adjustedBid = Math.round(currentBid * criticalInventoryBidMultiplier * 100) / 100;
    return {
      originalBid: currentBid,
      adjustedBid,
      bidMultiplier: criticalInventoryBidMultiplier,
      inventoryLevel: 'critical',
      inventoryDays,
      action: 'reduce',
      reason: `库存危急（剩余${inventoryDays || '<3'}天），强制降价50%延长售卖时间`,
    };
  }
  
  if (inventoryLevel === 'low' || (inventoryDays !== undefined && inventoryDays <= lowInventoryThreshold)) {
    const adjustedBid = Math.round(currentBid * lowInventoryBidMultiplier * 100) / 100;
    return {
      originalBid: currentBid,
      adjustedBid,
      bidMultiplier: lowInventoryBidMultiplier,
      inventoryLevel: 'low',
      inventoryDays,
      action: 'reduce',
      reason: `库存偏低（剩余${inventoryDays || '<7'}天），降低出价30%控制销售速度`,
    };
  }
  
  return {
    originalBid: currentBid,
    adjustedBid: currentBid,
    bidMultiplier: 1,
    inventoryLevel: 'normal',
    inventoryDays,
    action: 'normal',
    reason: '库存正常，无需库存保护调整',
  };
}

/**
 * 计算自然排名策略调整
 */
export function calculateOrganicRankStrategy(
  currentBid: number,
  organicRank?: number
): OrganicRankStrategyResult {
  const { organicRankThreshold, organicRankBidReduction } = INVENTORY_PROTECTION_CONFIG;
  
  if (organicRank === undefined || organicRank <= 0) {
    return {
      originalBid: currentBid,
      adjustedBid: currentBid,
      bidReduction: 0,
      organicRank: 0,
      shouldReduceBid: false,
      reason: '无自然排名数据，保持当前出价',
    };
  }
  
  if (organicRank <= organicRankThreshold) {
    const bidReduction = organicRankBidReduction;
    const adjustedBid = Math.round(currentBid * (1 - bidReduction) * 100) / 100;
    return {
      originalBid: currentBid,
      adjustedBid,
      bidReduction,
      organicRank,
      shouldReduceBid: true,
      reason: `自然排名第${organicRank}名（前${organicRankThreshold}名），降低广告出价${Math.round(bidReduction * 100)}%避免重复购买已有流量`,
    };
  }
  
  return {
    originalBid: currentBid,
    adjustedBid: currentBid,
    bidReduction: 0,
    organicRank,
    shouldReduceBid: false,
    reason: `自然排名第${organicRank}名，需要广告补充流量`,
  };
}

/**
 * 综合应用库存和自然排名策略
 */
export function applyBusinessAwareAdjustments(
  target: OptimizationTarget,
  baseBid: number
): {
  finalBid: number;
  inventoryProtection?: InventoryProtectionResult;
  organicRankStrategy?: OrganicRankStrategyResult;
  totalAdjustmentReason: string;
} {
  let finalBid = baseBid;
  const reasons: string[] = [];
  
  let inventoryProtection: InventoryProtectionResult | undefined;
  if (target.inventoryLevel || target.inventoryDays !== undefined || target.isStockout) {
    const level = target.isStockout ? 'out_of_stock' : target.inventoryLevel;
    inventoryProtection = calculateInventoryProtection(finalBid, level, target.inventoryDays);
    
    if (inventoryProtection.action !== 'normal') {
      finalBid = inventoryProtection.adjustedBid;
      reasons.push(inventoryProtection.reason);
    }
  }
  
  let organicRankStrategy: OrganicRankStrategyResult | undefined;
  if (target.organicRank !== undefined && 
      (!inventoryProtection || inventoryProtection.action === 'normal')) {
    organicRankStrategy = calculateOrganicRankStrategy(finalBid, target.organicRank);
    
    if (organicRankStrategy.shouldReduceBid) {
      finalBid = organicRankStrategy.adjustedBid;
      reasons.push(organicRankStrategy.reason);
    }
  }
  
  if (finalBid > 0) {
    finalBid = Math.max(finalBid, 0.02);
  }
  
  return {
    finalBid: Math.round(finalBid * 100) / 100,
    inventoryProtection,
    organicRankStrategy,
    totalAdjustmentReason: reasons.length > 0 
      ? reasons.join('；') 
      : '无业务感知调整',
  };
}
