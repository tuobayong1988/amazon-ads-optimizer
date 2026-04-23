/**
 * Composite Impact Coordinator (跨维度叠加效应协调器)
 * 
 * 解决问题：系统中五个优化维度（基础竞价、位置倾斜、分时竞价、分时预算、整体预算）
 * 各自独立执行，每个维度的调整都在单维度安全范围内，但叠加后可能远超安全范围。
 * 
 * 设计原则：
 * 1. 用户偏好要求：竞价调整不得超过过去7天平均CPC的±10%
 * 2. 用户偏好要求：预算调整不得超过过去7天平均花费的±25%
 * 3. 位置倾向调整不得超过过去7天设定数据的±25%，且不突破200%
 * 4. 所有维度的叠加效果必须在综合安全范围内
 * 
 * 协调策略：
 * - 在每个优化周期开始前，计算当前已累积的各维度调整
 * - 为后续维度分配"剩余调整预算"
 * - 当综合影响度超过阈值时，自动缩减后续维度的调整幅度
 */

import { getDb } from '../db';
const log = console;

// ==================== 类型定义 ====================

export interface DimensionAdjustment {
  dimension: 'base_bid' | 'placement' | 'dayparting_bid' | 'dayparting_budget' | 'overall_budget';
  entityType: 'keyword' | 'product_target' | 'campaign';
  entityId: number;
  campaignId: number;
  accountId: number;
  previousValue: number;
  newValue: number;
  changePercent: number;  // 变化百分比（正数为提高，负数为降低）
  timestamp: Date;
}

export interface CompositeImpactResult {
  // 竞价维度综合影响
  bidCompositeImpact: number;       // 基础竞价 × 位置倾斜 × 分时竞价的综合乘数
  bidCompositeChangePercent: number; // 综合变化百分比
  bidWithinSafeRange: boolean;
  
  // 预算维度综合影响
  budgetCompositeImpact: number;    // 整体预算 × 分时预算的综合乘数
  budgetCompositeChangePercent: number;
  budgetWithinSafeRange: boolean;
  
  // 协调建议
  allowedBidAdjustmentPercent: number;   // 当前维度允许的最大竞价调整百分比
  allowedBudgetAdjustmentPercent: number; // 当前维度允许的最大预算调整百分比
  
  // 诊断信息
  dimensions: DimensionAdjustment[];
  warnings: string[];
}

// ==================== 安全阈值配置 ====================

/**
 * 综合安全阈值 — 基于用户偏好
 * 
 * 核心原则：无论通过多少个维度叠加，最终的综合效果都不能超过这些阈值
 */
export const COMPOSITE_SAFETY_LIMITS = {
  // 竞价综合安全范围：相对于7天平均CPC
  bid: {
    maxCompositeChangePercent: 10,   // 用户偏好：±10% of 7-day avg CPC
    maxCompositeMultiplier: 1.10,    // 最大综合乘数
    minCompositeMultiplier: 0.90,    // 最小综合乘数
    // 各维度的预算分配（总和 = maxCompositeChangePercent）
    // v718-fix10: 维度预算分配（总和≤maxCompositeChangePercent=10%）
    dimensionBudgets: {
      base_bid: 5,           // 基础竞价最多用5%
      placement: 3,          // 位置倾斜最多用3%（Amazon端乘法叠加）
      dayparting_bid: 2,     // 分时竞价最多用2%
    },
  },
  // 预算综合安全范围：相对于7天平均花费
  budget: {
    maxCompositeChangePercent: 25,   // 用户偏好：±25% of 7-day avg spend
    maxCompositeMultiplier: 1.25,
    minCompositeMultiplier: 0.75,
    dimensionBudgets: {
      overall_budget: 18,    // 整体预算最多用18%
      dayparting_budget: 7,  // 分时预算最多用7%
    },
  },
  // 位置倾斜安全范围
  placement: {
    maxChangePercent: 25,    // 用户偏好：±25%
    absoluteMax: 200,        // 绝对上限200%
  },
};

// ==================== 核心协调函数 ====================

/**
 * 计算当前优化周期内某个实体（keyword/campaign）的综合影响度
 * 在每个维度执行前调用，获取"剩余调整预算"
 */
export async function calculateCompositeImpact(
  accountId: number,
  entityId: number,
  entityType: 'keyword' | 'product_target' | 'campaign',
  currentDimension: DimensionAdjustment['dimension'],
  lookbackHours: number = 24,
): Promise<CompositeImpactResult> {
  const warnings: string[] = [];
  const dimensions: DimensionAdjustment[] = [];
  
  try {
    const db = await getDb();
    if (!db) {
      return createDefaultResult(currentDimension, warnings);
    }
    
    // 查询过去N小时内该实体在各维度的调整记录
    const cutoffTime = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
    
    const recentAdjustments = await db.execute(
      `SELECT 
        event_category,
        action_type,
        old_value,
        new_value,
        change_percent,
        created_at
      FROM optimization_events
      WHERE account_id = ?
        AND (keyword_id = ? OR campaign_id = ?)
        AND created_at >= ?
        AND event_category IN ('bid_adjustment', 'placement_adjustment', 'budget_adjustment', 'settings_change')
      ORDER BY created_at ASC`,
      [accountId, entityId, entityId, cutoffTime.toISOString()]
    );
    
    // 分类统计各维度的累计调整
    let baseBidMultiplier = 1.0;
    let placementMultiplier = 1.0;
    let daypartingBidMultiplier = 1.0;
    let overallBudgetMultiplier = 1.0;
    let daypartingBudgetMultiplier = 1.0;
    
    // @ts-expect-error - DB result type
    const rows = recentAdjustments?.rows || recentAdjustments || [];
    for (const row of rows as Record<string, unknown>[]) {
      const oldVal = parseFloat(String(row.old_value || '0'));
      const newVal = parseFloat(String(row.new_value || '0'));
      if (oldVal <= 0 || newVal <= 0) continue;
      
      const ratio = newVal / oldVal;
      const category = String(row.event_category);
      const actionType = String(row.action_type || '');
      
      if (category === 'bid_adjustment') {
        if (actionType.includes('dayparting')) {
          daypartingBidMultiplier *= ratio;
        } else {
          baseBidMultiplier *= ratio;
        }
      } else if (category === 'placement_adjustment') {
        placementMultiplier *= ratio;
      } else if (category === 'budget_adjustment') {
        if (actionType.includes('dayparting')) {
          daypartingBudgetMultiplier *= ratio;
        } else {
          overallBudgetMultiplier *= ratio;
        }
      }
    }
    
    // 计算竞价综合影响
    const bidCompositeMultiplier = baseBidMultiplier * placementMultiplier * daypartingBidMultiplier;
    const bidCompositeChangePercent = (bidCompositeMultiplier - 1.0) * 100;
    const bidWithinSafeRange = Math.abs(bidCompositeChangePercent) <= COMPOSITE_SAFETY_LIMITS.bid.maxCompositeChangePercent;
    
    // 计算预算综合影响
    const budgetCompositeMultiplier = overallBudgetMultiplier * daypartingBudgetMultiplier;
    const budgetCompositeChangePercent = (budgetCompositeMultiplier - 1.0) * 100;
    const budgetWithinSafeRange = Math.abs(budgetCompositeChangePercent) <= COMPOSITE_SAFETY_LIMITS.budget.maxCompositeChangePercent;
    
    // 计算当前维度允许的最大调整幅度
    let allowedBidAdjustmentPercent = COMPOSITE_SAFETY_LIMITS.bid.maxCompositeChangePercent;
    let allowedBudgetAdjustmentPercent = COMPOSITE_SAFETY_LIMITS.budget.maxCompositeChangePercent;
    
    if (currentDimension === 'base_bid' || currentDimension === 'dayparting_bid') {
      // 竞价维度：剩余预算 = 总预算 - 已用预算
      const usedBidPercent = Math.abs(bidCompositeChangePercent);
      allowedBidAdjustmentPercent = Math.max(0, COMPOSITE_SAFETY_LIMITS.bid.maxCompositeChangePercent - usedBidPercent);
      
      // 同时不超过该维度的预算分配
      const dimensionBudget = COMPOSITE_SAFETY_LIMITS.bid.dimensionBudgets[
        currentDimension as keyof typeof COMPOSITE_SAFETY_LIMITS.bid.dimensionBudgets
      ] || 5;
      allowedBidAdjustmentPercent = Math.min(allowedBidAdjustmentPercent, dimensionBudget);
      
      if (allowedBidAdjustmentPercent < 1) {
        warnings.push(`[CompositeImpact] 竞价调整预算已耗尽: 综合变化${bidCompositeChangePercent.toFixed(1)}%，当前维度${currentDimension}允许调整${allowedBidAdjustmentPercent.toFixed(1)}%`);
      }
    }
    
    if (currentDimension === 'overall_budget' || currentDimension === 'dayparting_budget') {
      const usedBudgetPercent = Math.abs(budgetCompositeChangePercent);
      allowedBudgetAdjustmentPercent = Math.max(0, COMPOSITE_SAFETY_LIMITS.budget.maxCompositeChangePercent - usedBudgetPercent);
      
      const dimensionBudget = COMPOSITE_SAFETY_LIMITS.budget.dimensionBudgets[
        currentDimension as keyof typeof COMPOSITE_SAFETY_LIMITS.budget.dimensionBudgets
      ] || 10;
      allowedBudgetAdjustmentPercent = Math.min(allowedBudgetAdjustmentPercent, dimensionBudget);
      
      if (allowedBudgetAdjustmentPercent < 1) {
        warnings.push(`[CompositeImpact] 预算调整预算已耗尽: 综合变化${budgetCompositeChangePercent.toFixed(1)}%，当前维度${currentDimension}允许调整${allowedBudgetAdjustmentPercent.toFixed(1)}%`);
      }
    }
    
    if (!bidWithinSafeRange) {
      warnings.push(`[CompositeImpact] 竞价综合影响超出安全范围: ${bidCompositeChangePercent.toFixed(1)}% (限制±${COMPOSITE_SAFETY_LIMITS.bid.maxCompositeChangePercent}%)`);
    }
    if (!budgetWithinSafeRange) {
      warnings.push(`[CompositeImpact] 预算综合影响超出安全范围: ${budgetCompositeChangePercent.toFixed(1)}% (限制±${COMPOSITE_SAFETY_LIMITS.budget.maxCompositeChangePercent}%)`);
    }
    
    return {
      bidCompositeImpact: bidCompositeMultiplier,
      bidCompositeChangePercent,
      bidWithinSafeRange,
      budgetCompositeImpact: budgetCompositeMultiplier,
      budgetCompositeChangePercent,
      budgetWithinSafeRange,
      allowedBidAdjustmentPercent,
      allowedBudgetAdjustmentPercent,
      dimensions,
      warnings,
    };
    
  } catch (error: unknown) {
    log.warn(`[CompositeImpact] 计算综合影响度失败: ${(error as Error).message}`);
    return createDefaultResult(currentDimension, warnings);
  }
}

/**
 * 应用综合影响度限制到出价调整
 * 在每个维度的出价推送前调用
 */
export function applyCompositeImpactLimit(
  proposedBid: number,
  currentBid: number,
  compositeResult: CompositeImpactResult,
  dimension: DimensionAdjustment['dimension'],
): { adjustedBid: number; wasLimited: boolean; reason: string } {
  const allowedPercent = compositeResult.allowedBidAdjustmentPercent;
  
  if (allowedPercent <= 0) {
    return {
      adjustedBid: currentBid,
      wasLimited: true,
      reason: `[CompositeImpact] ${dimension}调整被阻止: 综合竞价影响已达上限${compositeResult.bidCompositeChangePercent.toFixed(1)}%`,
    };
  }
  
  const proposedChangePercent = currentBid > 0 ? ((proposedBid - currentBid) / currentBid) * 100 : 0;
  
  if (Math.abs(proposedChangePercent) <= allowedPercent) {
    // 在允许范围内，不需要限制
    return {
      adjustedBid: proposedBid,
      wasLimited: false,
      reason: '',
    };
  }
  
  // 超出允许范围，截断到允许的最大值
  const direction = proposedChangePercent > 0 ? 1 : -1;
  const limitedBid = currentBid * (1 + direction * allowedPercent / 100);
  const roundedBid = Math.round(limitedBid * 100) / 100;
  
  return {
    adjustedBid: Math.max(roundedBid, 0.02),
    wasLimited: true,
    reason: `[CompositeImpact] ${dimension}调整被限制: 提议${proposedChangePercent.toFixed(1)}% → 允许${(direction * allowedPercent).toFixed(1)}% (综合影响${compositeResult.bidCompositeChangePercent.toFixed(1)}%)`,
  };
}

/**
 * 应用综合影响度限制到预算调整
 */
export function applyCompositeImpactBudgetLimit(
  proposedBudget: number,
  currentBudget: number,
  compositeResult: CompositeImpactResult,
  dimension: DimensionAdjustment['dimension'],
): { adjustedBudget: number; wasLimited: boolean; reason: string } {
  const allowedPercent = compositeResult.allowedBudgetAdjustmentPercent;
  
  if (allowedPercent <= 0) {
    return {
      adjustedBudget: currentBudget,
      wasLimited: true,
      reason: `[CompositeImpact] ${dimension}预算调整被阻止: 综合预算影响已达上限${compositeResult.budgetCompositeChangePercent.toFixed(1)}%`,
    };
  }
  
  const proposedChangePercent = currentBudget > 0 ? ((proposedBudget - currentBudget) / currentBudget) * 100 : 0;
  
  if (Math.abs(proposedChangePercent) <= allowedPercent) {
    return {
      adjustedBudget: proposedBudget,
      wasLimited: false,
      reason: '',
    };
  }
  
  const direction = proposedChangePercent > 0 ? 1 : -1;
  const limitedBudget = currentBudget * (1 + direction * allowedPercent / 100);
  const roundedBudget = Math.round(limitedBudget * 100) / 100;
  
  return {
    adjustedBudget: Math.max(roundedBudget, 1.00),
    wasLimited: true,
    reason: `[CompositeImpact] ${dimension}预算调整被限制: 提议${proposedChangePercent.toFixed(1)}% → 允许${(direction * allowedPercent).toFixed(1)}% (综合影响${compositeResult.budgetCompositeChangePercent.toFixed(1)}%)`,
  };
}

/**
 * 批量计算多个实体的综合影响度（用于batchCalculateNextGenBids等批量场景）
 */
export async function batchCalculateCompositeImpact(
  accountId: number,
  entityIds: number[],
  entityType: 'keyword' | 'product_target' | 'campaign',
  currentDimension: DimensionAdjustment['dimension'],
  lookbackHours: number = 24,
): Promise<Map<number, CompositeImpactResult>> {
  const results = new Map<number, CompositeImpactResult>();
  
  try {
    const db = await getDb();
    if (!db || entityIds.length === 0) {
      // 返回默认结果
      for (const id of entityIds) {
        results.set(id, createDefaultResult(currentDimension, []));
      }
      return results;
    }
    
    const cutoffTime = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
    
    // 批量查询所有实体的最近调整记录
    const placeholders = entityIds.map(() => '?').join(',');
    const idColumn = entityType === 'campaign' ? 'campaign_id' : 'keyword_id';
    
    const recentAdjustments = await db.execute(
      `SELECT 
        ${idColumn} as entity_id,
        event_category,
        action_type,
        old_value,
        new_value,
        created_at
      FROM optimization_events
      WHERE account_id = ?
        AND ${idColumn} IN (${placeholders})
        AND created_at >= ?
        AND event_category IN ('bid_adjustment', 'placement_adjustment', 'budget_adjustment', 'settings_change')
      ORDER BY ${idColumn}, created_at ASC`,
      [accountId, ...entityIds, cutoffTime.toISOString()]
    );
    
    // 按实体分组统计
    const entityAdjustments = new Map<number, { baseBid: number; placement: number; daypartingBid: number; overallBudget: number; daypartingBudget: number }>();
    
    // @ts-expect-error - DB result type
    const rows = recentAdjustments?.rows || recentAdjustments || [];
    for (const row of rows as Record<string, unknown>[]) {
      const entityId = Number(row.entity_id);
      if (!entityAdjustments.has(entityId)) {
        entityAdjustments.set(entityId, { baseBid: 1.0, placement: 1.0, daypartingBid: 1.0, overallBudget: 1.0, daypartingBudget: 1.0 });
      }
      const adj = entityAdjustments.get(entityId)!;
      
      const oldVal = parseFloat(String(row.old_value || '0'));
      const newVal = parseFloat(String(row.new_value || '0'));
      if (oldVal <= 0 || newVal <= 0) continue;
      
      const ratio = newVal / oldVal;
      const category = String(row.event_category);
      const actionType = String(row.action_type || '');
      
      if (category === 'bid_adjustment') {
        if (actionType.includes('dayparting')) {
          adj.daypartingBid *= ratio;
        } else {
          adj.baseBid *= ratio;
        }
      } else if (category === 'placement_adjustment') {
        adj.placement *= ratio;
      } else if (category === 'budget_adjustment') {
        if (actionType.includes('dayparting')) {
          adj.daypartingBudget *= ratio;
        } else {
          adj.overallBudget *= ratio;
        }
      }
    }
    
    // 为每个实体计算综合影响
    for (const id of entityIds) {
      const adj = entityAdjustments.get(id) || { baseBid: 1.0, placement: 1.0, daypartingBid: 1.0, overallBudget: 1.0, daypartingBudget: 1.0 };
      
      const bidComposite = adj.baseBid * adj.placement * adj.daypartingBid;
      const bidChangePercent = (bidComposite - 1.0) * 100;
      
      const budgetComposite = adj.overallBudget * adj.daypartingBudget;
      const budgetChangePercent = (budgetComposite - 1.0) * 100;
      
      // 计算当前维度允许的调整幅度
      let allowedBid = COMPOSITE_SAFETY_LIMITS.bid.maxCompositeChangePercent;
      let allowedBudget = COMPOSITE_SAFETY_LIMITS.budget.maxCompositeChangePercent;
      
      if (currentDimension === 'base_bid' || currentDimension === 'dayparting_bid') {
        const usedBid = Math.abs(bidChangePercent);
        allowedBid = Math.max(0, COMPOSITE_SAFETY_LIMITS.bid.maxCompositeChangePercent - usedBid);
        const dimBudget = COMPOSITE_SAFETY_LIMITS.bid.dimensionBudgets[
          currentDimension as keyof typeof COMPOSITE_SAFETY_LIMITS.bid.dimensionBudgets
        ] || 5;
        allowedBid = Math.min(allowedBid, dimBudget);
      }
      
      if (currentDimension === 'overall_budget' || currentDimension === 'dayparting_budget') {
        const usedBudget = Math.abs(budgetChangePercent);
        allowedBudget = Math.max(0, COMPOSITE_SAFETY_LIMITS.budget.maxCompositeChangePercent - usedBudget);
        const dimBudget = COMPOSITE_SAFETY_LIMITS.budget.dimensionBudgets[
          currentDimension as keyof typeof COMPOSITE_SAFETY_LIMITS.budget.dimensionBudgets
        ] || 10;
        allowedBudget = Math.min(allowedBudget, dimBudget);
      }
      
      const warnings: string[] = [];
      if (Math.abs(bidChangePercent) > COMPOSITE_SAFETY_LIMITS.bid.maxCompositeChangePercent) {
        warnings.push(`竞价综合影响${bidChangePercent.toFixed(1)}%超出±${COMPOSITE_SAFETY_LIMITS.bid.maxCompositeChangePercent}%`);
      }
      if (Math.abs(budgetChangePercent) > COMPOSITE_SAFETY_LIMITS.budget.maxCompositeChangePercent) {
        warnings.push(`预算综合影响${budgetChangePercent.toFixed(1)}%超出±${COMPOSITE_SAFETY_LIMITS.budget.maxCompositeChangePercent}%`);
      }
      
      results.set(id, {
        bidCompositeImpact: bidComposite,
        bidCompositeChangePercent: bidChangePercent,
        bidWithinSafeRange: Math.abs(bidChangePercent) <= COMPOSITE_SAFETY_LIMITS.bid.maxCompositeChangePercent,
        budgetCompositeImpact: budgetComposite,
        budgetCompositeChangePercent: budgetChangePercent,
        budgetWithinSafeRange: Math.abs(budgetChangePercent) <= COMPOSITE_SAFETY_LIMITS.budget.maxCompositeChangePercent,
        allowedBidAdjustmentPercent: allowedBid,
        allowedBudgetAdjustmentPercent: allowedBudget,
        dimensions: [],
        warnings,
      });
    }
    
  } catch (error: unknown) {
    log.warn(`[CompositeImpact] 批量计算失败: ${(error as Error).message}`);
    for (const id of entityIds) {
      results.set(id, createDefaultResult(currentDimension, [`批量计算异常: ${(error as Error).message}`]));
    }
  }
  
  return results;
}

// ==================== 辅助函数 ====================

function createDefaultResult(
  currentDimension: DimensionAdjustment['dimension'],
  warnings: string[],
): CompositeImpactResult {
  // 默认结果：允许该维度的预算分配
  const bidDimBudget = COMPOSITE_SAFETY_LIMITS.bid.dimensionBudgets[
    currentDimension as keyof typeof COMPOSITE_SAFETY_LIMITS.bid.dimensionBudgets
  ] || COMPOSITE_SAFETY_LIMITS.bid.maxCompositeChangePercent;
  
  const budgetDimBudget = COMPOSITE_SAFETY_LIMITS.budget.dimensionBudgets[
    currentDimension as keyof typeof COMPOSITE_SAFETY_LIMITS.budget.dimensionBudgets
  ] || COMPOSITE_SAFETY_LIMITS.budget.maxCompositeChangePercent;
  
  return {
    bidCompositeImpact: 1.0,
    bidCompositeChangePercent: 0,
    bidWithinSafeRange: true,
    budgetCompositeImpact: 1.0,
    budgetCompositeChangePercent: 0,
    budgetWithinSafeRange: true,
    allowedBidAdjustmentPercent: bidDimBudget,
    allowedBudgetAdjustmentPercent: budgetDimBudget,
    dimensions: [],
    warnings,
  };
}
