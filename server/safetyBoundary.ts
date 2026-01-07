/**
 * 安全边界计算模块
 * 
 * 用于计算预算、竞价、位置调整的安全边界
 * 所有调整都基于近7天平均值（排除最近2天数据）
 */

import { getDb } from "./db";
import { dailyPerformance, campaigns, keywords, bidAdjustmentHistory } from "../drizzle/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";

// 安全边界配置
export const SAFETY_LIMITS = {
  BUDGET: {
    MAX_INCREASE_PERCENT: 25,  // 预算最大上调幅度
    MAX_DECREASE_PERCENT: 25,  // 预算最大下调幅度
  },
  BID: {
    MAX_INCREASE_PERCENT: 10,  // 竞价最大上调幅度
    MAX_DECREASE_PERCENT: 10,  // 竞价最大下调幅度
  },
  PLACEMENT: {
    MAX_INCREASE_PERCENT: 25,  // 位置最大上调幅度
    MAX_DECREASE_PERCENT: 25,  // 位置最大下调幅度
    ABSOLUTE_MAX: 200,         // 位置调整绝对上限
  },
  DATA_WINDOW: {
    TOTAL_DAYS: 7,             // 数据窗口总天数
    EXCLUDE_RECENT_DAYS: 2,    // 排除最近天数
  },
};

/**
 * 获取数据窗口的日期范围
 * 返回第3天前到第9天前的日期范围
 */
export function getDataWindowDates(): { startDate: Date; endDate: Date } {
  const now = new Date();
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() - SAFETY_LIMITS.DATA_WINDOW.EXCLUDE_RECENT_DAYS);
  endDate.setHours(23, 59, 59, 999);
  
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - (SAFETY_LIMITS.DATA_WINDOW.TOTAL_DAYS + SAFETY_LIMITS.DATA_WINDOW.EXCLUDE_RECENT_DAYS));
  startDate.setHours(0, 0, 0, 0);
  
  return { startDate, endDate };
}

/**
 * 计算近7天平均花费（排除最近2天）
 */
export async function getAverageSpend(
  accountId: number,
  campaignId?: number
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
  const { startDate, endDate } = getDataWindowDates();
  
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  
  let query = `
    SELECT AVG(spend) as avgSpend
    FROM daily_performance
    WHERE account_id = ?
    AND date >= ?
    AND date <= ?
  `;
  const params: any[] = [accountId, startDateStr, endDateStr];
  
  if (campaignId) {
    query += ` AND campaign_id = ?`;
    params.push(campaignId);
  }
  
  const result = await db.execute(sql.raw(query));
  const rows = result as any[];
  return rows[0]?.avgSpend || 0;
}

/**
 * 计算近7天平均CPC（排除最近2天）
 */
export async function getAverageCPC(
  accountId: number,
  campaignId?: number,
  keywordId?: number
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
  const { startDate, endDate } = getDataWindowDates();
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  
  let query = `
    SELECT 
      CASE WHEN SUM(clicks) > 0 THEN SUM(spend) / SUM(clicks) ELSE 0 END as avgCpc
    FROM daily_performance
    WHERE account_id = ?
    AND date >= ?
    AND date <= ?
  `;
  const params: any[] = [accountId, startDateStr, endDateStr];
  
  if (campaignId) {
    query += ` AND campaign_id = ?`;
    params.push(campaignId);
  }
  
  const result = await db.execute(sql.raw(query));
  const rows = result as any[];
  return rows[0]?.avgCpc || 0;
}

/**
 * 计算近7天平均位置调整百分比（排除最近2天）
 */
export async function getAveragePlacementAdjustment(
  accountId: number,
  campaignId: number,
  placementType: 'top' | 'product_page'
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
  // 从campaign表获取当前位置调整设置
  const campaign = await db
    .select({
      topOfSearchBidAdjustment: campaigns.topOfSearchBidAdjustment,
      productPageBidAdjustment: campaigns.productPageBidAdjustment,
    })
    .from(campaigns)
    .where(and(
      eq(campaigns.accountId, accountId),
      eq(campaigns.id, campaignId)
    ))
    .limit(1);
  
  if (campaign.length === 0) return 0;
  
  // 返回当前设置值作为基准
  const currentValue = placementType === 'top' 
    ? campaign[0].topOfSearchBidAdjustment 
    : campaign[0].productPageBidAdjustment;
  
  return Number(currentValue) || 0;
}

// ==================== 预算安全边界 ====================

export interface BudgetBoundary {
  currentBudget: number;
  averageSpend: number;
  minAllowed: number;
  maxAllowed: number;
  suggestedBudget: number;
  adjustmentPercent: number;
  isWithinBounds: boolean;
}

/**
 * 计算预算安全边界
 */
export async function calculateBudgetBoundary(
  accountId: number,
  campaignId: number,
  currentBudget: number,
  suggestedBudget: number
): Promise<BudgetBoundary> {
  const averageSpend = await getAverageSpend(accountId, campaignId);
  
  // 计算允许的最大最小值
  const maxAllowed = currentBudget * (1 + SAFETY_LIMITS.BUDGET.MAX_INCREASE_PERCENT / 100);
  const minAllowed = currentBudget * (1 - SAFETY_LIMITS.BUDGET.MAX_DECREASE_PERCENT / 100);
  
  // 限制建议值在安全边界内
  const boundedSuggestion = Math.max(minAllowed, Math.min(maxAllowed, suggestedBudget));
  
  // 计算实际调整幅度
  const adjustmentPercent = currentBudget > 0 
    ? ((boundedSuggestion - currentBudget) / currentBudget) * 100 
    : 0;
  
  return {
    currentBudget,
    averageSpend,
    minAllowed,
    maxAllowed,
    suggestedBudget: boundedSuggestion,
    adjustmentPercent,
    isWithinBounds: suggestedBudget >= minAllowed && suggestedBudget <= maxAllowed,
  };
}

/**
 * 应用预算安全边界
 */
export function applyBudgetSafetyBoundary(
  currentBudget: number,
  suggestedBudget: number
): number {
  const maxAllowed = currentBudget * (1 + SAFETY_LIMITS.BUDGET.MAX_INCREASE_PERCENT / 100);
  const minAllowed = currentBudget * (1 - SAFETY_LIMITS.BUDGET.MAX_DECREASE_PERCENT / 100);
  
  return Math.max(minAllowed, Math.min(maxAllowed, suggestedBudget));
}

// ==================== 竞价安全边界 ====================

export interface BidBoundary {
  currentBid: number;
  averageCPC: number;
  minAllowed: number;
  maxAllowed: number;
  suggestedBid: number;
  adjustmentPercent: number;
  isWithinBounds: boolean;
}

/**
 * 计算竞价安全边界
 */
export async function calculateBidBoundary(
  accountId: number,
  campaignId: number,
  keywordId: number | undefined,
  currentBid: number,
  suggestedBid: number
): Promise<BidBoundary> {
  const averageCPC = await getAverageCPC(accountId, campaignId, keywordId);
  
  // 计算允许的最大最小值
  const maxAllowed = currentBid * (1 + SAFETY_LIMITS.BID.MAX_INCREASE_PERCENT / 100);
  const minAllowed = currentBid * (1 - SAFETY_LIMITS.BID.MAX_DECREASE_PERCENT / 100);
  
  // 限制建议值在安全边界内
  const boundedSuggestion = Math.max(minAllowed, Math.min(maxAllowed, suggestedBid));
  
  // 计算实际调整幅度
  const adjustmentPercent = currentBid > 0 
    ? ((boundedSuggestion - currentBid) / currentBid) * 100 
    : 0;
  
  return {
    currentBid,
    averageCPC,
    minAllowed,
    maxAllowed,
    suggestedBid: boundedSuggestion,
    adjustmentPercent,
    isWithinBounds: suggestedBid >= minAllowed && suggestedBid <= maxAllowed,
  };
}

/**
 * 应用竞价安全边界
 */
export function applyBidSafetyBoundary(
  currentBid: number,
  suggestedBid: number
): number {
  const maxAllowed = currentBid * (1 + SAFETY_LIMITS.BID.MAX_INCREASE_PERCENT / 100);
  const minAllowed = currentBid * (1 - SAFETY_LIMITS.BID.MAX_DECREASE_PERCENT / 100);
  
  return Math.max(minAllowed, Math.min(maxAllowed, suggestedBid));
}

// ==================== 位置调整安全边界 ====================

export interface PlacementBoundary {
  currentAdjustment: number;
  averageAdjustment: number;
  minAllowed: number;
  maxAllowed: number;
  suggestedAdjustment: number;
  adjustmentPercent: number;
  isWithinBounds: boolean;
}

/**
 * 计算位置调整安全边界
 */
export async function calculatePlacementBoundary(
  accountId: number,
  campaignId: number,
  placementType: 'top' | 'product_page',
  currentAdjustment: number,
  suggestedAdjustment: number
): Promise<PlacementBoundary> {
  const averageAdjustment = await getAveragePlacementAdjustment(accountId, campaignId, placementType);
  
  // 计算允许的最大最小值
  let maxAllowed = currentAdjustment * (1 + SAFETY_LIMITS.PLACEMENT.MAX_INCREASE_PERCENT / 100);
  const minAllowed = currentAdjustment * (1 - SAFETY_LIMITS.PLACEMENT.MAX_DECREASE_PERCENT / 100);
  
  // 应用绝对上限
  maxAllowed = Math.min(maxAllowed, SAFETY_LIMITS.PLACEMENT.ABSOLUTE_MAX);
  
  // 限制建议值在安全边界内
  const boundedSuggestion = Math.max(minAllowed, Math.min(maxAllowed, suggestedAdjustment));
  
  // 计算实际调整幅度
  const adjustmentPercent = currentAdjustment > 0 
    ? ((boundedSuggestion - currentAdjustment) / currentAdjustment) * 100 
    : 0;
  
  return {
    currentAdjustment,
    averageAdjustment,
    minAllowed,
    maxAllowed,
    suggestedAdjustment: boundedSuggestion,
    adjustmentPercent,
    isWithinBounds: suggestedAdjustment >= minAllowed && suggestedAdjustment <= maxAllowed,
  };
}

/**
 * 应用位置调整安全边界
 */
export function applyPlacementSafetyBoundary(
  currentAdjustment: number,
  suggestedAdjustment: number
): number {
  let maxAllowed = currentAdjustment * (1 + SAFETY_LIMITS.PLACEMENT.MAX_INCREASE_PERCENT / 100);
  const minAllowed = currentAdjustment * (1 - SAFETY_LIMITS.PLACEMENT.MAX_DECREASE_PERCENT / 100);
  
  // 应用绝对上限
  maxAllowed = Math.min(maxAllowed, SAFETY_LIMITS.PLACEMENT.ABSOLUTE_MAX);
  
  return Math.max(minAllowed, Math.min(maxAllowed, suggestedAdjustment));
}

// ==================== 批量安全边界检查 ====================

export interface SafetyCheckResult {
  type: 'budget' | 'bid' | 'placement';
  entityId: number;
  entityName: string;
  currentValue: number;
  suggestedValue: number;
  boundedValue: number;
  wasAdjusted: boolean;
  adjustmentPercent: number;
  reason?: string;
}

/**
 * 批量检查预算安全边界
 */
export async function batchCheckBudgetBoundaries(
  accountId: number,
  budgetChanges: Array<{
    campaignId: number;
    campaignName: string;
    currentBudget: number;
    suggestedBudget: number;
  }>
): Promise<SafetyCheckResult[]> {
  const results: SafetyCheckResult[] = [];
  
  for (const change of budgetChanges) {
    const boundary = await calculateBudgetBoundary(
      accountId,
      change.campaignId,
      change.currentBudget,
      change.suggestedBudget
    );
    
    results.push({
      type: 'budget',
      entityId: change.campaignId,
      entityName: change.campaignName,
      currentValue: change.currentBudget,
      suggestedValue: change.suggestedBudget,
      boundedValue: boundary.suggestedBudget,
      wasAdjusted: !boundary.isWithinBounds,
      adjustmentPercent: boundary.adjustmentPercent,
      reason: !boundary.isWithinBounds 
        ? `原建议超出±${SAFETY_LIMITS.BUDGET.MAX_INCREASE_PERCENT}%安全边界，已自动调整` 
        : undefined,
    });
  }
  
  return results;
}

/**
 * 批量检查竞价安全边界
 */
export async function batchCheckBidBoundaries(
  accountId: number,
  bidChanges: Array<{
    campaignId: number;
    keywordId?: number;
    keywordText: string;
    currentBid: number;
    suggestedBid: number;
  }>
): Promise<SafetyCheckResult[]> {
  const results: SafetyCheckResult[] = [];
  
  for (const change of bidChanges) {
    const boundary = await calculateBidBoundary(
      accountId,
      change.campaignId,
      change.keywordId,
      change.currentBid,
      change.suggestedBid
    );
    
    results.push({
      type: 'bid',
      entityId: change.keywordId || change.campaignId,
      entityName: change.keywordText,
      currentValue: change.currentBid,
      suggestedValue: change.suggestedBid,
      boundedValue: boundary.suggestedBid,
      wasAdjusted: !boundary.isWithinBounds,
      adjustmentPercent: boundary.adjustmentPercent,
      reason: !boundary.isWithinBounds 
        ? `原建议超出±${SAFETY_LIMITS.BID.MAX_INCREASE_PERCENT}%安全边界，已自动调整` 
        : undefined,
    });
  }
  
  return results;
}

/**
 * 批量检查位置调整安全边界
 */
export async function batchCheckPlacementBoundaries(
  accountId: number,
  placementChanges: Array<{
    campaignId: number;
    campaignName: string;
    placementType: 'top' | 'product_page';
    currentAdjustment: number;
    suggestedAdjustment: number;
  }>
): Promise<SafetyCheckResult[]> {
  const results: SafetyCheckResult[] = [];
  
  for (const change of placementChanges) {
    const boundary = await calculatePlacementBoundary(
      accountId,
      change.campaignId,
      change.placementType,
      change.currentAdjustment,
      change.suggestedAdjustment
    );
    
    let reason: string | undefined;
    if (!boundary.isWithinBounds) {
      if (change.suggestedAdjustment > SAFETY_LIMITS.PLACEMENT.ABSOLUTE_MAX) {
        reason = `原建议超出${SAFETY_LIMITS.PLACEMENT.ABSOLUTE_MAX}%绝对上限，已自动调整`;
      } else {
        reason = `原建议超出±${SAFETY_LIMITS.PLACEMENT.MAX_INCREASE_PERCENT}%安全边界，已自动调整`;
      }
    }
    
    results.push({
      type: 'placement',
      entityId: change.campaignId,
      entityName: `${change.campaignName} - ${change.placementType === 'top' ? '搜索结果顶部' : '商品页面'}`,
      currentValue: change.currentAdjustment,
      suggestedValue: change.suggestedAdjustment,
      boundedValue: boundary.suggestedAdjustment,
      wasAdjusted: !boundary.isWithinBounds,
      adjustmentPercent: boundary.adjustmentPercent,
      reason,
    });
  }
  
  return results;
}
