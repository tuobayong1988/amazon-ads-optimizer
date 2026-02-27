import { createModuleLogger } from './utils/logger';
const log = createModuleLogger('OptimizationSafetyGuardrails');
/**
 * optimizationSafetyGuardrails.ts - 优化安全护栏
 * 
 * v162: 防止极端调整导致快速亏损或订单骤降
 * 
 * 三大护栏：
 * 1. 竞价调整护栏 - 限制单次/每日竞价调整幅度
 * 2. 预算调整护栏 - 限制预算变动幅度和频率
 * 3. 位置调整护栏 - 限制位置倾斜变动幅度
 * 
 * 安全原则：
 * - 单次调整不超过当前值的20%（竞价）/ 25%（预算）
 * - 每日累计调整不超过30%
 * - 连续3天同方向调整时自动降速
 * - 异常表现下降时触发紧急制动
 */

import * as db from './db';
import { and, eq, sql } from 'drizzle-orm';

// ==================== 配置常量 ====================

export const SAFETY_LIMITS = {
  bid: {
    maxSingleChangePercent: 0.20,     // 单次最大调整幅度 20%
    maxDailyChangePercent: 0.30,      // 每日累计最大调整幅度 30%
    minBid: 0.02,                     // 最低出价 $0.02
    maxBid: 100,                      // 最高出价 $100（绝对上限）
    consecutiveSameDirectionSlowdown: 3, // 连续同方向调整N次后降速
    slowdownFactor: 0.5,              // 降速因子（调整幅度减半）
  },
  budget: {
    maxSingleChangePercent: 0.25,     // 单次最大调整幅度 25%
    maxDailyChangePercent: 0.35,      // 每日累计最大调整幅度 35%
    minDailyBudget: 1,                // 最低日预算 $1
    maxDailyBudget: 50000,            // 最高日预算 $50,000
  },
  placement: {
    maxSingleChangePct: 25,           // 单次最大调整幅度 25个百分点
    maxTotalAdjustment: 200,          // 最高位置倾斜 200%
    minTotalAdjustment: -50,          // 最低位置倾斜 -50%
  },
  emergency: {
    salesDropThreshold: 0.40,         // 销售额下降40%触发紧急制动
    spendSurgeThreshold: 2.0,         // 花费激增200%触发紧急制动
    ordersDropThreshold: 0.50,        // 订单下降50%触发紧急制动
    lookbackDays: 3,                  // 紧急制动回看天数
  }
};

// ==================== 竞价安全护栏 ====================

export interface BidGuardrailResult {
  originalBid: number;
  safeBid: number;
  wasLimited: boolean;
  limitReason: string | null;
}

/**
 * 应用竞价安全护栏
 * 确保竞价调整在安全范围内
 */
export function applyBidGuardrail(
  currentBid: number,
  proposedBid: number,
  userMaxBid?: number | null,
  consecutiveSameDirection?: number
): BidGuardrailResult {
  let safeBid = proposedBid;
  let wasLimited = false;
  let limitReason: string | null = null;
  
  // 1. 绝对范围限制
  const effectiveMaxBid = Math.min(
    userMaxBid || SAFETY_LIMITS.bid.maxBid,
    SAFETY_LIMITS.bid.maxBid
  );
  
  if (safeBid > effectiveMaxBid) {
    safeBid = effectiveMaxBid;
    wasLimited = true;
    limitReason = `超过最高出价限制$${effectiveMaxBid.toFixed(2)}`;
  }
  
  if (safeBid < SAFETY_LIMITS.bid.minBid) {
    safeBid = SAFETY_LIMITS.bid.minBid;
    wasLimited = true;
    limitReason = `低于最低出价$${SAFETY_LIMITS.bid.minBid}`;
  }
  
  // 2. 单次调整幅度限制
  let maxChangePercent = SAFETY_LIMITS.bid.maxSingleChangePercent;
  
  // 连续同方向调整时降速
  if (consecutiveSameDirection && consecutiveSameDirection >= SAFETY_LIMITS.bid.consecutiveSameDirectionSlowdown) {
    maxChangePercent *= SAFETY_LIMITS.bid.slowdownFactor;
  }
  
  const maxIncrease = currentBid * (1 + maxChangePercent);
  const maxDecrease = currentBid * (1 - maxChangePercent);
  
  if (safeBid > maxIncrease) {
    safeBid = maxIncrease;
    wasLimited = true;
    limitReason = `单次提价幅度限制为${(maxChangePercent * 100).toFixed(0)}%`;
  }
  
  if (safeBid < maxDecrease && currentBid > SAFETY_LIMITS.bid.minBid) {
    safeBid = maxDecrease;
    wasLimited = true;
    limitReason = `单次降价幅度限制为${(maxChangePercent * 100).toFixed(0)}%`;
  }
  
  // 3. 四舍五入到分
  safeBid = Math.round(safeBid * 100) / 100;
  
  return {
    originalBid: proposedBid,
    safeBid,
    wasLimited,
    limitReason,
  };
}

// ==================== 预算安全护栏 ====================

export interface BudgetGuardrailResult {
  originalBudget: number;
  safeBudget: number;
  wasLimited: boolean;
  limitReason: string | null;
}

/**
 * 应用预算安全护栏
 */
export function applyBudgetGuardrail(
  currentBudget: number,
  proposedBudget: number,
  userDailyBudgetLimit?: number | null
): BudgetGuardrailResult {
  let safeBudget = proposedBudget;
  let wasLimited = false;
  let limitReason: string | null = null;
  
  // 1. 绝对范围限制
  if (safeBudget < SAFETY_LIMITS.budget.minDailyBudget) {
    safeBudget = SAFETY_LIMITS.budget.minDailyBudget;
    wasLimited = true;
    limitReason = `低于最低日预算$${SAFETY_LIMITS.budget.minDailyBudget}`;
  }
  
  const effectiveMax = Math.min(
    userDailyBudgetLimit || SAFETY_LIMITS.budget.maxDailyBudget,
    SAFETY_LIMITS.budget.maxDailyBudget
  );
  
  if (safeBudget > effectiveMax) {
    safeBudget = effectiveMax;
    wasLimited = true;
    limitReason = `超过日预算上限$${effectiveMax.toFixed(2)}`;
  }
  
  // 2. 单次调整幅度限制
  if (currentBudget > 0) {
    const changePercent = (safeBudget - currentBudget) / currentBudget;
    
    if (changePercent > SAFETY_LIMITS.budget.maxSingleChangePercent) {
      safeBudget = currentBudget * (1 + SAFETY_LIMITS.budget.maxSingleChangePercent);
      wasLimited = true;
      limitReason = `单次预算增加幅度限制为${(SAFETY_LIMITS.budget.maxSingleChangePercent * 100).toFixed(0)}%`;
    }
    
    if (changePercent < -SAFETY_LIMITS.budget.maxSingleChangePercent) {
      safeBudget = currentBudget * (1 - SAFETY_LIMITS.budget.maxSingleChangePercent);
      wasLimited = true;
      limitReason = `单次预算减少幅度限制为${(SAFETY_LIMITS.budget.maxSingleChangePercent * 100).toFixed(0)}%`;
    }
  }
  
  // 3. 四舍五入到分
  safeBudget = Math.round(safeBudget * 100) / 100;
  
  return {
    originalBudget: proposedBudget,
    safeBudget,
    wasLimited,
    limitReason,
  };
}

// ==================== 位置调整安全护栏 ====================

export interface PlacementGuardrailResult {
  originalAdjustment: number;
  safeAdjustment: number;
  wasLimited: boolean;
  limitReason: string | null;
}

/**
 * 应用位置调整安全护栏
 * @param currentAdjustment - 当前位置倾斜百分比（如 50 表示 50%）
 * @param proposedAdjustment - 建议的位置倾斜百分比
 */
export function applyPlacementGuardrail(
  currentAdjustment: number,
  proposedAdjustment: number
): PlacementGuardrailResult {
  let safeAdjustment = proposedAdjustment;
  let wasLimited = false;
  let limitReason: string | null = null;
  
  // 1. 绝对范围限制
  if (safeAdjustment > SAFETY_LIMITS.placement.maxTotalAdjustment) {
    safeAdjustment = SAFETY_LIMITS.placement.maxTotalAdjustment;
    wasLimited = true;
    limitReason = `位置倾斜不超过${SAFETY_LIMITS.placement.maxTotalAdjustment}%`;
  }
  
  if (safeAdjustment < SAFETY_LIMITS.placement.minTotalAdjustment) {
    safeAdjustment = SAFETY_LIMITS.placement.minTotalAdjustment;
    wasLimited = true;
    limitReason = `位置倾斜不低于${SAFETY_LIMITS.placement.minTotalAdjustment}%`;
  }
  
  // 2. 单次变动幅度限制
  const delta = Math.abs(safeAdjustment - currentAdjustment);
  if (delta > SAFETY_LIMITS.placement.maxSingleChangePct) {
    const direction = safeAdjustment > currentAdjustment ? 1 : -1;
    safeAdjustment = currentAdjustment + direction * SAFETY_LIMITS.placement.maxSingleChangePct;
    wasLimited = true;
    limitReason = `单次位置调整幅度限制为${SAFETY_LIMITS.placement.maxSingleChangePct}个百分点`;
  }
  
  // 3. 四舍五入
  safeAdjustment = Math.round(safeAdjustment);
  
  return {
    originalAdjustment: proposedAdjustment,
    safeAdjustment,
    wasLimited,
    limitReason,
  };
}

// ==================== 紧急制动检测 ====================

export interface EmergencyBrakeResult {
  triggered: boolean;
  reason: string | null;
  recommendation: 'pause_optimization' | 'reduce_bids' | 'reduce_budgets' | 'none';
}

/**
 * 检测是否需要触发紧急制动
 * 比较最近N天的表现与之前N天的表现
 */
export async function checkEmergencyBrake(
  accountId: number,
  performanceGroupId: number
): Promise<EmergencyBrakeResult> {
  try {
    const lookback = SAFETY_LIMITS.emergency.lookbackDays;
    const now = new Date();
    
    // 最近N天
    const recentEnd = new Date(now);
    const recentStart = new Date(now);
    recentStart.setDate(recentStart.getDate() - lookback);
    
    // 之前N天
    const previousEnd = new Date(recentStart);
    const previousStart = new Date(previousEnd);
    previousStart.setDate(previousStart.getDate() - lookback);
    
    const campaigns = await db.getCampaignsByPerformanceGroupId(performanceGroupId);
    if (campaigns.length === 0) {
      return { triggered: false, reason: null, recommendation: 'none' };
    }
    
    // 汇总最近N天和之前N天的数据
    let recentSpend = 0, recentSales = 0, recentOrders = 0;
    let previousSpend = 0, previousSales = 0, previousOrders = 0;
    
    for (const campaign of campaigns) {
      try {
        // v206: getDailyPerformanceByDateRange需要Amazon campaignId（varchar）
        const recentData = await db.getDailyPerformanceByDateRange(accountId, recentStart, recentEnd, campaign.campaignId);
        const previousData = await db.getDailyPerformanceByDateRange(accountId, previousStart, previousEnd, campaign.campaignId);
        
        for (const d of recentData) {
          recentSpend += Number(d.spend) || 0;
          recentSales += Number(d.sales) || 0;
          recentOrders += d.orders || 0;
        }
        
        for (const d of previousData) {
          previousSpend += Number(d.spend) || 0;
          previousSales += Number(d.sales) || 0;
          previousOrders += d.orders || 0;
        }
      } catch (e) {
        // 跳过数据获取失败的campaign
      }
    }
    
    // 数据不足 - v230: 提高最低数据阈值以避免小数据量下的误触发
    if (previousSpend < 10 && previousSales < 10) {
      return { triggered: false, reason: null, recommendation: 'none' };
    }
    
    // v230: 检查最近是否有优化操作，用于因果归因
    let hasRecentOptimization = false;
    try {
      const { optimizationLogs } = await import('../drizzle/schema');
      const dbInstance = await db.getDb();
      if (dbInstance) {
        const recentOps = await dbInstance.select({ id: optimizationLogs.id })
          .from(optimizationLogs)
          .where(and(
            eq(optimizationLogs.accountId, accountId),
            sql`created_at >= DATE_SUB(NOW(), INTERVAL ${lookback} DAY)`,
            eq(optimizationLogs.status, 'applied' as any)
          ))
          .limit(1);
        hasRecentOptimization = recentOps.length > 0;
      }
    } catch (e) {
      // 无法查询时保守处理
    }
    
    // v230: 检测销售额骤降 - 增加因果归因
    if (previousSales > 30) {  // v230: 提高最低销售额阈值
      const salesDropRate = (previousSales - recentSales) / previousSales;
      if (salesDropRate >= SAFETY_LIMITS.emergency.salesDropThreshold) {
        // v230: 只有当最近有优化操作时才触发紧急制动
        // 如果没有优化操作，下降可能是自然波动，只记录警告而不触发制动
        if (hasRecentOptimization) {
          return {
            triggered: true,
            reason: `销售额${lookback}天内下降${(salesDropRate * 100).toFixed(0)}%（$${previousSales.toFixed(0)}→$${recentSales.toFixed(0)}），且最近有优化操作`,
            recommendation: 'reduce_bids',
          };
        }
        // v230: 无优化操作时记录但不触发制动
        log.warn(`[EmergencyBrake] v230: 销售额下降${(salesDropRate * 100).toFixed(0)}%但无近期优化操作，判定为自然波动，不触发制动`);
      }
    }
    
    // v230: 检测花费激增 - 增加因果归因
    if (previousSpend > 20) {  // v230: 提高最低花费阈值
      const spendSurgeRate = recentSpend / previousSpend;
      if (spendSurgeRate >= SAFETY_LIMITS.emergency.spendSurgeThreshold && recentSales < previousSales * 1.2) {
        if (hasRecentOptimization) {
          return {
            triggered: true,
            reason: `花费${lookback}天内激增${((spendSurgeRate - 1) * 100).toFixed(0)}%但销售未同步增长，且最近有优化操作`,
            recommendation: 'reduce_budgets',
          };
        }
        log.warn(`[EmergencyBrake] v230: 花费激增${((spendSurgeRate - 1) * 100).toFixed(0)}%但无近期优化操作，判定为自然波动`);
      }
    }
    
    // v230: 检测订单骤降 - 增加因果归因
    if (previousOrders > 10) {  // v230: 提高最低订单阈值
      const ordersDropRate = (previousOrders - recentOrders) / previousOrders;
      if (ordersDropRate >= SAFETY_LIMITS.emergency.ordersDropThreshold) {
        if (hasRecentOptimization) {
          return {
            triggered: true,
            reason: `订单${lookback}天内下降${(ordersDropRate * 100).toFixed(0)}%（${previousOrders}→${recentOrders}），且最近有优化操作`,
            recommendation: 'pause_optimization',
          };
        }
        log.warn(`[EmergencyBrake] v230: 订单下降${(ordersDropRate * 100).toFixed(0)}%但无近期优化操作，判定为自然波动`);
      }
    }
    
    return { triggered: false, reason: null, recommendation: 'none' };
  } catch (error) {
    log.error(`[EmergencyBrake] Error checking group ${performanceGroupId}:`, error);
    return { triggered: false, reason: null, recommendation: 'none' };
  }
}

/**
 * 在优化执行前检查安全护栏
 * 如果触发紧急制动，返回建议的操作
 */
export async function preOptimizationSafetyCheck(
  accountId: number,
  performanceGroupId: number
): Promise<{ safe: boolean; warnings: string[] }> {
  const warnings: string[] = [];
  
  const brakeResult = await checkEmergencyBrake(accountId, performanceGroupId);
  
  if (brakeResult.triggered) {
    warnings.push(`⚠️ 紧急制动: ${brakeResult.reason}`);
    warnings.push(`建议操作: ${
      brakeResult.recommendation === 'pause_optimization' ? '暂停自动优化' :
      brakeResult.recommendation === 'reduce_bids' ? '降低竞价10%' :
      brakeResult.recommendation === 'reduce_budgets' ? '降低预算15%' :
      '继续监控'
    }`);
  }
  
  return {
    safe: !brakeResult.triggered,
    warnings,
  };
}
