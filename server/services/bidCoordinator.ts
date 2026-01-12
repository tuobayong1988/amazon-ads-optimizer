/**
 * 中央竞价协调器
 * 
 * 专家建议：解决"多头马车"问题
 * 不要让各个Service直接写数据库改出价，而是提交"建议"
 * 
 * 问题场景：
 * - bidOptimizer 调整 Base Bid (基础出价)
 * - daypartingService 调整 Hourly Multiplier (分时折扣)
 * - placementService 调整 Placement Multiplier (位置溢价)
 * 
 * 如果三者独立运行且互不知情：
 * Base Bid +20% × 分时 +50% × 位置 +50% = 最终出价 2.7倍
 * 
 * 解决方案：
 * 1. 各服务提交"建议"而非直接执行
 * 2. 协调器计算理论最高CPC
 * 3. 实施熔断机制防止CPC爆炸
 */

import { getDb } from '../db';
import { sql } from 'drizzle-orm';

// ==================== 类型定义 ====================

/**
 * 竞价建议来源
 */
export type BidProposalSource = 'base_algo' | 'dayparting' | 'placement' | 'inventory' | 'organic_rank';

/**
 * 竞价建议
 */
export interface BidProposal {
  targetId: number;
  targetType: 'campaign' | 'adGroup' | 'keyword';
  source: BidProposalSource;
  suggestedMultiplier: number; // 比如 1.2 表示 +20%
  suggestedBaseBid?: number;   // 绝对值建议（可选）
  confidence: number;          // 建议置信度 0-1
  reason: string;              // 建议原因
  timestamp: Date;
}

/**
 * 协调后的竞价结果
 */
export interface CoordinatedBidResult {
  targetId: number;
  targetType: 'campaign' | 'adGroup' | 'keyword';
  originalBaseBid: number;
  finalBaseBid: number;
  theoreticalMaxCPC: number;
  effectiveMultiplier: number;
  proposals: BidProposal[];
  circuitBreakerTriggered: boolean;
  circuitBreakerReason?: string;
  warnings: string[];
}

// ==================== 配置 ====================

/**
 * 协调器配置
 */
export const COORDINATOR_CONFIG = {
  // 硬性CPC上限（美元）
  maxAllowedCPC: 5.0,
  
  // 软性CPC警告阈值（美元）
  cpcWarningThreshold: 3.0,
  
  // 最大允许的总乘数
  maxTotalMultiplier: 2.5,
  
  // 熔断后的强制乘数上限
  circuitBreakerMultiplier: 1.5,
  
  // 最小出价（美元）
  minBid: 0.02,
  
  // 最大出价（美元）
  maxBid: 100.0,
  
  // 各来源的默认权重
  sourceWeights: {
    base_algo: 1.0,
    dayparting: 0.8,
    placement: 0.7,
    inventory: 1.0,  // 库存保护优先级最高
    organic_rank: 0.6,
  } as Record<BidProposalSource, number>,
};

// ==================== 核心函数 ====================

/**
 * 应用协调后的竞价
 * 专家建议：不要让各个Service直接写数据库，而是提交"建议"
 * 
 * @param campaignId - 广告活动ID
 * @param accountId - 账号ID
 * @param proposals - 各服务提交的竞价建议
 * @param currentBaseBid - 当前基础出价
 * @param currentPlacementMultiplier - 当前位置溢价（百分比，如50表示+50%）
 * @param currentDaypartingMultiplier - 当前分时乘数（如1.5表示×1.5）
 */
export async function applyCoordinatedBids(
  campaignId: string,
  accountId: number,
  proposals: BidProposal[],
  currentBaseBid: number,
  currentPlacementMultiplier: number = 0,
  currentDaypartingMultiplier: number = 1
): Promise<CoordinatedBidResult> {
  const warnings: string[] = [];
  
  // 1. 按来源分组建议
  const proposalsBySource = groupProposalsBySource(proposals);
  
  // 2. 计算加权后的基础出价调整
  let baseBidMultiplier = 1;
  let baseBidAbsolute: number | null = null;
  
  for (const [source, sourceProposals] of Object.entries(proposalsBySource)) {
    const weight = COORDINATOR_CONFIG.sourceWeights[source as BidProposalSource] || 0.5;
    
    for (const proposal of sourceProposals) {
      if (proposal.suggestedBaseBid !== undefined) {
        // 绝对值建议，取加权平均
        if (baseBidAbsolute === null) {
          baseBidAbsolute = proposal.suggestedBaseBid * weight;
        } else {
          baseBidAbsolute = (baseBidAbsolute + proposal.suggestedBaseBid * weight) / 2;
        }
      } else {
        // 乘数建议，累乘但加权
        const adjustedMultiplier = 1 + (proposal.suggestedMultiplier - 1) * weight * proposal.confidence;
        baseBidMultiplier *= adjustedMultiplier;
      }
    }
  }
  
  // 3. 计算新的基础出价
  let newBaseBid = baseBidAbsolute !== null 
    ? baseBidAbsolute 
    : currentBaseBid * baseBidMultiplier;
  
  // 4. 计算理论最高CPC
  // 最终出价 = Base Bid × 分时乘数 × (1 + 位置溢价/100)
  const placementMultiplier = 1 + currentPlacementMultiplier / 100;
  const theoreticalMaxCPC = newBaseBid * currentDaypartingMultiplier * placementMultiplier;
  
  // 5. 熔断机制
  let circuitBreakerTriggered = false;
  let circuitBreakerReason: string | undefined;
  
  if (theoreticalMaxCPC > COORDINATOR_CONFIG.maxAllowedCPC) {
    circuitBreakerTriggered = true;
    circuitBreakerReason = `理论最高CPC($${theoreticalMaxCPC.toFixed(2)})超过上限($${COORDINATOR_CONFIG.maxAllowedCPC})`;
    
    // 逆向倒推安全的Base Bid
    newBaseBid = COORDINATOR_CONFIG.maxAllowedCPC / (currentDaypartingMultiplier * placementMultiplier);
    
    warnings.push(`[熔断] ${circuitBreakerReason}，Base Bid从$${currentBaseBid.toFixed(2)}下调至$${newBaseBid.toFixed(2)}`);
  }
  
  // 6. 检查总乘数是否过高
  const totalMultiplier = (newBaseBid / currentBaseBid) * currentDaypartingMultiplier * placementMultiplier;
  if (totalMultiplier > COORDINATOR_CONFIG.maxTotalMultiplier && !circuitBreakerTriggered) {
    warnings.push(`[警告] 总乘数(${totalMultiplier.toFixed(2)}x)超过阈值(${COORDINATOR_CONFIG.maxTotalMultiplier}x)`);
  }
  
  // 7. CPC警告
  if (theoreticalMaxCPC > COORDINATOR_CONFIG.cpcWarningThreshold && !circuitBreakerTriggered) {
    warnings.push(`[警告] 理论最高CPC($${theoreticalMaxCPC.toFixed(2)})超过警告阈值($${COORDINATOR_CONFIG.cpcWarningThreshold})`);
  }
  
  // 8. 确保出价在合理范围内
  newBaseBid = Math.max(COORDINATOR_CONFIG.minBid, Math.min(COORDINATOR_CONFIG.maxBid, newBaseBid));
  newBaseBid = Math.round(newBaseBid * 100) / 100; // 保留两位小数
  
  // 9. 计算最终的有效乘数
  const effectiveMultiplier = currentBaseBid > 0 ? newBaseBid / currentBaseBid : 1;
  
  // 10. 记录协调日志
  await logCoordinationResult(accountId, campaignId, {
    originalBaseBid: currentBaseBid,
    finalBaseBid: newBaseBid,
    theoreticalMaxCPC: newBaseBid * currentDaypartingMultiplier * placementMultiplier,
    circuitBreakerTriggered,
    proposalCount: proposals.length,
  });
  
  return {
    targetId: parseInt(campaignId) || 0,
    targetType: 'campaign',
    originalBaseBid: currentBaseBid,
    finalBaseBid: newBaseBid,
    theoreticalMaxCPC: newBaseBid * currentDaypartingMultiplier * placementMultiplier,
    effectiveMultiplier,
    proposals,
    circuitBreakerTriggered,
    circuitBreakerReason,
    warnings,
  };
}

/**
 * 创建竞价建议
 */
export function createBidProposal(
  targetId: number,
  targetType: 'campaign' | 'adGroup' | 'keyword',
  source: BidProposalSource,
  options: {
    suggestedMultiplier?: number;
    suggestedBaseBid?: number;
    confidence?: number;
    reason: string;
  }
): BidProposal {
  return {
    targetId,
    targetType,
    source,
    suggestedMultiplier: options.suggestedMultiplier ?? 1,
    suggestedBaseBid: options.suggestedBaseBid,
    confidence: options.confidence ?? 0.8,
    reason: options.reason,
    timestamp: new Date(),
  };
}

/**
 * 计算安全的最大出价
 * 专家建议：给定位置溢价和分时乘数，计算不超过CPC上限的最大Base Bid
 */
export function calculateSafeMaxBid(
  placementMultiplier: number,
  daypartingMultiplier: number,
  maxCPC: number = COORDINATOR_CONFIG.maxAllowedCPC
): number {
  const effectivePlacementMultiplier = 1 + placementMultiplier / 100;
  const safeMaxBid = maxCPC / (daypartingMultiplier * effectivePlacementMultiplier);
  return Math.round(safeMaxBid * 100) / 100;
}

/**
 * 验证竞价组合是否安全
 */
export function validateBidCombination(
  baseBid: number,
  placementMultiplier: number,
  daypartingMultiplier: number
): {
  isValid: boolean;
  theoreticalMaxCPC: number;
  warnings: string[];
  suggestions: string[];
} {
  const effectivePlacementMultiplier = 1 + placementMultiplier / 100;
  const theoreticalMaxCPC = baseBid * daypartingMultiplier * effectivePlacementMultiplier;
  
  const warnings: string[] = [];
  const suggestions: string[] = [];
  
  // 检查是否超过硬性上限
  if (theoreticalMaxCPC > COORDINATOR_CONFIG.maxAllowedCPC) {
    warnings.push(`理论最高CPC($${theoreticalMaxCPC.toFixed(2)})超过上限($${COORDINATOR_CONFIG.maxAllowedCPC})`);
    
    const safeMaxBid = calculateSafeMaxBid(placementMultiplier, daypartingMultiplier);
    suggestions.push(`建议将Base Bid降至$${safeMaxBid.toFixed(2)}以下`);
  }
  
  // 检查是否超过警告阈值
  if (theoreticalMaxCPC > COORDINATOR_CONFIG.cpcWarningThreshold && 
      theoreticalMaxCPC <= COORDINATOR_CONFIG.maxAllowedCPC) {
    warnings.push(`理论最高CPC($${theoreticalMaxCPC.toFixed(2)})接近上限`);
  }
  
  // 检查总乘数
  const totalMultiplier = daypartingMultiplier * effectivePlacementMultiplier;
  if (totalMultiplier > COORDINATOR_CONFIG.maxTotalMultiplier) {
    warnings.push(`总乘数(${totalMultiplier.toFixed(2)}x)过高`);
    suggestions.push('建议降低位置溢价或分时乘数');
  }
  
  return {
    isValid: theoreticalMaxCPC <= COORDINATOR_CONFIG.maxAllowedCPC,
    theoreticalMaxCPC,
    warnings,
    suggestions,
  };
}

// ==================== 辅助函数 ====================

/**
 * 按来源分组建议
 */
function groupProposalsBySource(
  proposals: BidProposal[]
): Record<BidProposalSource, BidProposal[]> {
  const grouped: Record<BidProposalSource, BidProposal[]> = {
    base_algo: [],
    dayparting: [],
    placement: [],
    inventory: [],
    organic_rank: [],
  };
  
  for (const proposal of proposals) {
    if (grouped[proposal.source]) {
      grouped[proposal.source].push(proposal);
    }
  }
  
  return grouped;
}

/**
 * 记录协调结果日志
 */
async function logCoordinationResult(
  accountId: number,
  campaignId: string,
  result: {
    originalBaseBid: number;
    finalBaseBid: number;
    theoreticalMaxCPC: number;
    circuitBreakerTriggered: boolean;
    proposalCount: number;
  }
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    
    // 记录到日志表（如果存在）
    // 这里只打印日志，实际生产环境应该写入数据库
    console.log('[BidCoordinator] 协调结果:', {
      accountId,
      campaignId,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[BidCoordinator] 记录日志失败:', error);
  }
}

/**
 * 获取Campaign当前的竞价配置
 */
export async function getCampaignBidConfig(
  accountId: number,
  campaignId: string
): Promise<{
  baseBid: number;
  placementMultiplier: number;
  daypartingMultiplier: number;
  biddingStrategy: string;
} | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    
    const [rows] = await db.execute(sql`
      SELECT 
        defaultBid as baseBid,
        COALESCE(topOfSearchMultiplier, 0) as placementMultiplier,
        biddingStrategy
      FROM campaigns
      WHERE accountId = ${accountId}
        AND campaignId = ${campaignId}
      LIMIT 1
    `) as any;
    
    const campaign = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!campaign) return null;
    
    return {
      baseBid: campaign.baseBid || 0,
      placementMultiplier: campaign.placementMultiplier || 0,
      daypartingMultiplier: 1, // 需要从分时配置中获取
      biddingStrategy: campaign.biddingStrategy || 'manual',
    };
  } catch (error) {
    console.error('[BidCoordinator] 获取Campaign配置失败:', error);
    return null;
  }
}

export default {
  applyCoordinatedBids,
  createBidProposal,
  calculateSafeMaxBid,
  validateBidCombination,
  getCampaignBidConfig,
  COORDINATOR_CONFIG,
};
