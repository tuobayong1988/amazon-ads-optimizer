/**
 * v362: 优化目标引擎 - bidCoordinationExecutor
 * 从 optimizationTargetEngine.ts 拆分
 * 
 * 包含函数: executeBidCoordination
 */

/**
 * 优化目标自动执行引擎
 * 
 * 核心理念：优化目标作为所有优化算法的统一执行入口
 * 当优化目标启用后，自动对其下的广告活动执行所有优化策略
 * 
 * 优化策略包括：
 * 1. 广告活动位置百分比调整
 * 2. 投放词分时竞价
 * 3. 客户搜索词分析和处理
 * 4. 预算分配优化
 * 5. 投放词暂停/启用决策
 */

import * as db from "../db";
import { getDb } from "../db";
import { keywords as keywordsTable, productTargets as productTargetsTable, campaigns as campaignsTable } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { safeInClause } from '../utils/safeSql';
import * as bidOptimizer from "../optimization/bidOptimizer";
import * as daypartingService from "../budget/daypartingService";
import * as placementOptimizationService from "../optimization/placementOptimizationService";
import { preOptimizationSafetyCheck, applyBidGuardrail, applyBudgetGuardrail, applyPlacementGuardrail, SAFETY_LIMITS } from '../optimization/optimizationSafetyGuardrails';
import * as adAutomation from "../automation/adAutomation";
import * as intelligentBudgetAllocationService from "../budget/intelligentBudgetAllocationService";
import { optimizeBudgetPortfolio } from "../budget/budgetPortfolioOptimizer";
import * as bidCoordinator from "../services/bidCoordinator";
import * as nextGenOrchestrator from "../optimization/nextGenBidOrchestrator";
import * as amazonApiHelper from "../services/amazonApiHelper";
import { acquireAccountOptimizationLock, releaseAccountOptimizationLock, getModuleLockGroup } from "../utils/lockManager";
import * as amazonIdResolver from "../services/amazonIdResolver";
import { getLocalHour, getLocalDayOfWeek, isNewKeyword, getExplorationStrategy, isProtectedKeyword } from "../algorithm/algorithmUtils";
import * as campaignLifecycleService from "../services/campaignLifecycleService";
import * as timeDecayService from "../analytics/timeDecayWeightedDataService";
import * as gradualEngine from "../optimization/gradualOptimizationEngine";
import * as selfEvolution from "../algorithm/selfEvolutionEngine";
import * as multiDimOptimizer from "../optimization/multiDimensionOptimizer";
import * as multiDimComboAnalyzer from "../optimization/multiDimComboAnalyzer";
import * as postOptVerifier from "../optimization/postOptimizationVerifier";
import { registerActiveTask, unregisterActiveTask, isShuttingDown } from "../utils/taskLifecycle";
import { decideTargeting } from "../services/targetingAlgorithm";
import type { SearchTermPerformance, TargetingDecision } from "../services/targetingAlgorithm";
import { sanitizeAndValidateKeyword, canAddPositiveKeyword, isAsinSearchTerm, adGroupHasProductTargets, isProductTargetingCampaign } from "../utils/keywordValidator";
import { createModuleLogger } from '../utils/logger';
import { getCampaignAmazonId, getCampaignLocalId } from '../utils/idTypes';
import { recordAudit, auditBidChange } from '../services/auditLogService';
import { generateNegativeKeywordSuggestions, executeNegativeKeywords as executeNgramNegativeKeywords } from '../analytics/ngramAnalysis';

const log = createModuleLogger('TargetEngine');

// 缓存账号站点信息，避免重复查询
import type { OptimizationExecutionResult, OptimizationTargetConfig } from './types';

export async function executeBidCoordination(
  config: OptimizationTargetConfig,
  campaigns: any[],
  bidDetails: unknown[],
  placementDetails: unknown[],
  daypartingDetails: unknown[],
  dryRun: boolean
): Promise<{ executed: boolean; campaignsCoordinated: number; circuitBreakerTriggered: number; details: Record<string, any>[] }> {
  const details: Record<string, any>[] = [];
  let campaignsCoordinated = 0;
  let circuitBreakerTriggered = 0;
  
  // 按广告活动分组处理
  for (const campaign of (campaigns as any[])) {
    const campaignLocalId = getCampaignLocalId(campaign);
    const campaignAmazonId = getCampaignAmazonId(campaign);
    try {
      const proposals: bidCoordinator.BidProposal[] = [];
      
      // 1. 收集出价优化建议
      // @ts-ignore
      const bidSuggestions = bidDetails.filter(d => d.localCampaignId === campaignLocalId);
      for (const suggestion of (bidSuggestions as any[])) {
        if (suggestion.newBid && suggestion.currentBid) {
          const multiplier = suggestion.newBid / suggestion.currentBid;
          proposals.push(bidCoordinator.createBidProposal(
            campaignLocalId,
            'campaign',
            'base_algo',
            {
              suggestedMultiplier: multiplier,
              confidence: 0.85,
              reason: suggestion.reason || '基于市场曲线的最优出价调整',
            }
          ));
        }
      }
      
      // 2. 收集位置优化建议
      // @ts-ignore
      const placementSuggestions = placementDetails.filter(d => d.localCampaignId === campaignLocalId);
      for (const suggestion of (placementSuggestions as any[])) {
        if (suggestion.suggestedMultiplier !== undefined) {
          proposals.push(bidCoordinator.createBidProposal(
            campaignLocalId,
            'campaign',
            'placement',
            {
              suggestedMultiplier: 1 + (suggestion.suggestedMultiplier - suggestion.currentMultiplier) / 100,
              confidence: 0.75,
              reason: suggestion.reason || '位置效率优化',
            }
          ));
        }
      }
      
      // 3. 收集分时策略建议
      // @ts-ignore
      const daypartingSuggestions = daypartingDetails.filter(d => d.localCampaignId === campaignLocalId);
      for (const suggestion of (daypartingSuggestions as any[])) {
        if (suggestion.bidMultiplier && suggestion.bidMultiplier !== 1) {
          proposals.push(bidCoordinator.createBidProposal(
            campaignLocalId,
            'campaign',
            'dayparting',
            {
              suggestedMultiplier: suggestion.bidMultiplier,
              confidence: 0.8,
              reason: `分时策略: ${suggestion.hour}:00 乘数${suggestion.bidMultiplier}`,
            }
          ));
        }
      }
      
      // 如果没有建议，跳过该广告活动
      if (proposals.length === 0) continue;
      
      // 4. 获取当前广告活动的竞价配置
      const currentBaseBid = parseFloat(campaign.defaultBid || '1');
      const currentPlacementMultiplier = parseFloat(campaign.topOfSearchMultiplier || '0');
      const currentDaypartingMultiplier = 1; // 分时乘数需要从策略中获取
      
      // 5. 调用中央协调器
      const coordinatedResult = await bidCoordinator.applyCoordinatedBids(
        campaignAmazonId,
        config.accountId,
        proposals,
        currentBaseBid,
        currentPlacementMultiplier,
        currentDaypartingMultiplier
      );
      
      // 6. 记录协调结果
      const coordinationDetail = {
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
        campaignName: campaign.campaignName,
        proposalsCount: proposals.length,
        originalBaseBid: coordinatedResult.originalBaseBid,
        finalBaseBid: coordinatedResult.finalBaseBid,
        theoreticalMaxCPC: coordinatedResult.theoreticalMaxCPC,
        effectiveMultiplier: coordinatedResult.effectiveMultiplier,
        circuitBreakerTriggered: coordinatedResult.circuitBreakerTriggered,
        circuitBreakerReason: coordinatedResult.circuitBreakerReason,
        warnings: coordinatedResult.warnings,
        algorithmUsed: 'bid_coordinator', // v335
      };
      
      details.push(coordinationDetail);
      campaignsCoordinated++;
      
      if (coordinatedResult.circuitBreakerTriggered) {
        circuitBreakerTriggered++;
      }
      
      // 7. 如果不是干运行且有实际调整，记录日志
      if (!dryRun && coordinatedResult.finalBaseBid !== coordinatedResult.originalBaseBid) {
        log.info(`[BidCoordination] 广告活动 ${campaign.campaign.campaignName} 价协调完成:`, {
          original: coordinatedResult.originalBaseBid,
          final: coordinatedResult.finalBaseBid,
          maxCPC: coordinatedResult.theoreticalMaxCPC,
          circuitBreaker: coordinatedResult.circuitBreakerTriggered,
        });
      }
    } catch (error: unknown) {
      details.push({
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
        campaignName: campaign.campaignName,
        error: (error as Error).message,
      });
    }
  }
  
  return { executed: true, campaignsCoordinated, circuitBreakerTriggered, details };
}

/**
 * 记录执行日志
 */
