/**
 * v362: 优化目标引擎 - placementExecutor
 * 从 optimizationTargetEngine.ts 拆分
 * 
 * 包含函数: executePlacementOptimization
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
import { decideTargeting, type SearchTermPerformance, type TargetingDecision } from "../services/targetingAlgorithm";
import { sanitizeAndValidateKeyword, canAddPositiveKeyword, isAsinSearchTerm, adGroupHasProductTargets, isProductTargetingCampaign } from "../utils/keywordValidator";
import { createModuleLogger } from '../utils/logger';
import { getCampaignAmazonId, getCampaignLocalId } from '../utils/idTypes';
import { recordAudit, auditBidChange } from '../services/auditLogService';
import { generateNegativeKeywordSuggestions, executeNegativeKeywords as executeNgramNegativeKeywords } from '../analytics/ngramAnalysis';

const log = createModuleLogger('TargetEngine');

// 缓存账号站点信息，避免重复查询
import type { OptimizationExecutionResult, OptimizationTargetConfig } from './types';

export async function executePlacementOptimization(
  config: OptimizationTargetConfig,
  campaigns: unknown[],
  dryRun: boolean
): Promise<{ executed: boolean; adjustmentsCount: number; details: Record<string, unknown>[] }> {
  const details: Record<string, unknown>[] = [];
  let adjustmentsCount = 0;
  
  // v183: 预加载多维度组合分析结果，用于智能位置倾斜
  let accountComboMap = new Map<number, Record<string, unknown>[]>(); // campaignId -> comboAnalysis[]
  try {
    const dbConn = await getDb();
    if (dbConn) {
      const allCombos = await multiDimComboAnalyzer.getComboAnalysisForAccount(dbConn, config.accountId);
      for (const combo of allCombos) {
        // @ts-expect-error Complex function parameter types
        if (!accountComboMap.has(combo.campaignId)) {
          // @ts-expect-error DB query type inference limitation
          accountComboMap.set(combo.campaignId, []);
        }
        // @ts-expect-error Array method type inference
        accountComboMap.get(combo.campaignId)!.push(combo);
      }
      log.info(`[PlacementOptimization] v183: 加载${allCombos.length}个投放词的组合分析结果`);
    }
  } catch (comboErr: unknown) {
    log.warn(`[PlacementOptimization] v183: 加载组合分析结果失败: ${(comboErr as Error).message}`);
  }

  let placementCampaignIndex = 0;
  for (const campaign of (campaigns as unknown[])) {
    // v476: 广告活动间节流 — 每个广告活动的位置优化间隔5秒
    if (placementCampaignIndex > 0) {
      await new Promise(resolve => setTimeout(resolve, 5000));
    // @ts-expect-error Legacy code type compatibility
    }
    // @ts-expect-error Legacy code type compatibility
    placementCampaignIndex++;

    // @ts-expect-error Type inference limitation
    const campaignLocalId = getCampaignLocalId(campaign);
    // @ts-expect-error Type inference limitation
    const campaignAmazonId = getCampaignAmazonId(campaign);
    try {
      // v337.1: 修复placement ID MISMATCH — placement_performance表存储的是Amazon ID (varchar)
      // v186错误地认为存储的是本地ID，v207已将同步改为存储Amazon ID，但v186的查询未同步更新
      // 修复: 统一使用Amazon ID查询placement_performance表
      
      // 分析位置表现（使用Amazon ID查询placement_performance表）
      const analysis = await placementOptimizationService.analyzePlacementPerformance(campaignAmazonId, config.accountId);
      
      // 生成位置调整建议（使用Amazon ID查询placement_performance表）
      const suggestions = await placementOptimizationService.generatePlacementSuggestions(
        campaignAmazonId,
        // @ts-expect-error Legacy code type compatibility
        config.accountId
      );
      
      // v353: 增强位置优化诊断日志 - 追踪建议生成和过滤原因
      if (suggestions.length === 0) {
        // @ts-expect-error Amazon API response type flexibility
        log.info(`[PlacementOptimization] v353诊断: Campaign "${campaign.campaignName}" (${campaignAmazonId}) 生成0条建议, analysis=${JSON.stringify({
          hasData: !!analysis,
          // @ts-expect-error Conditional type narrowing
          dataPoints: analysis?.dataPoints || 0,
          // @ts-expect-error Conditional type narrowing
          placements: analysis?.placements?.length || 0,
        })}`);
      } else {
        // @ts-expect-error Amazon API response type flexibility
        log.info(`[PlacementOptimization] v353诊断: Campaign "${campaign.campaignName}" (${campaignAmazonId}) 生成${suggestions.length}条建议: ${suggestions.map((s: Record<string, unknown>) => `${s.placement}: ${s.currentMultiplier}→${s.suggestedMultiplier}%`).join(', ')}`);
      }
      
      // v183: 基于多维度组合分析智能调整位置倾斜
      const campaignCombos = accountComboMap.get(campaignLocalId) || [];
      const goldenCombos = campaignCombos.filter((c: Record<string, unknown>) => c.comboCategory === 'golden' && c.confidenceLevel !== 'insufficient');
      
      // 统计黄金组合中各位置的表现
      // @ts-expect-error Type inference limitation
      let topOfSearchGoldenCount = 0;
      let productPageGoldenCount = 0;
      for (const combo of goldenCombos) {
        if (combo.bestPlacement === 'top_of_search') topOfSearchGoldenCount++;
        // @ts-expect-error Dynamic property access
        if (combo.bestPlacement === 'product_page') productPageGoldenCount++;
      }
      
      // @ts-expect-error Dynamic type assertion
      for (const suggestion of (suggestions as unknown[])) {
        // v183: 如果多维度分析显示某个位置有大量黄金组合，则增强该位置的倾斜
        // @ts-expect-error Type inference limitation
        let comboAdjustedMultiplier = suggestion.suggestedMultiplier;
        // @ts-expect-error Type inference limitation
        let comboReason = '';
        
        if (goldenCombos.length > 0) {
          // @ts-expect-error Dynamic property access
          if (suggestion.placement === 'top_of_search' && topOfSearchGoldenCount > goldenCombos.length * 0.5) {
            // 超过50%黄金组合的最佳位置是搜索顶部，增强搜索顶部倾斜
            // @ts-expect-error Type inference limitation
            const boost = Math.min(suggestion.suggestedMultiplier * 0.10, 20); // 最多额外+20%
            // @ts-expect-error Legacy code type compatibility
            comboAdjustedMultiplier = Math.min(suggestion.suggestedMultiplier + boost, 900); // Amazon上限900%
            // @ts-expect-error Legacy code type compatibility
            comboReason = ` [v183: ${topOfSearchGoldenCount}个黄金组合偏好搜索顶部, +${boost.toFixed(0)}%]`;
          // @ts-expect-error Dynamic property access
          } else if (suggestion.placement === 'product_page' && productPageGoldenCount > goldenCombos.length * 0.5) {
            // @ts-expect-error Type inference limitation
            const boost = Math.min(suggestion.suggestedMultiplier * 0.10, 20);
            // @ts-expect-error Legacy code type compatibility
            comboAdjustedMultiplier = Math.min(suggestion.suggestedMultiplier + boost, 900);
            comboReason = ` [v183: ${productPageGoldenCount}个黄金组合偏好商品页, +${boost.toFixed(0)}%]`;
          }
        }
        
        const adjustment: Record<string, unknown> = {
          // @ts-expect-error Legacy code type compatibility
          accountId: config.accountId,
          localCampaignId: campaignLocalId,
          amazonCampaignId: campaignAmazonId,
          // @ts-expect-error Amazon API response type flexibility
          campaignName: campaign.campaignName,
          // @ts-expect-error Legacy code type compatibility
          placement: suggestion.placement,
          // @ts-expect-error Legacy code type compatibility
          currentMultiplier: suggestion.currentMultiplier,
          suggestedMultiplier: comboAdjustedMultiplier,
          // @ts-expect-error Legacy code type compatibility
          originalSuggestedMultiplier: suggestion.suggestedMultiplier,
          // @ts-expect-error Legacy code type compatibility
          reason: suggestion.reason + comboReason,
          algorithmUsed: 'placement_optimizer', // v335: 添加算法标识
          apiSyncStatus: dryRun ? 'pending' : 'pending',
          comboGoldenCount: goldenCombos.length,
        };
        
        details.push(adjustment);
        
        // @ts-expect-error Conditional type narrowing
        if (!dryRun && comboAdjustedMultiplier !== suggestion.currentMultiplier) {
          // v337.1: 修复 — placement_settings表的campaignId也是varchar，应使用Amazon ID
          await placementOptimizationService.applyPlacementAdjustment(
            // @ts-expect-error Legacy code type compatibility
            campaignAmazonId,
            // @ts-expect-error Legacy code type compatibility
            config.accountId,
            // @ts-expect-error Destructuring type inference
            { ...suggestion, suggestedMultiplier: comboAdjustedMultiplier }
          // @ts-expect-error Legacy code type compatibility
          );
          adjustmentsCount++;
        }
      }
      
      // v134: 同步位置倾斜到 Amazon API，并记录同步状态
      if (!dryRun && suggestions.length > 0) {
        let placementSyncSuccess = false;
        let placementSyncError = '';
        try {
          // v186: Amazon API调用必须使用Amazon Campaign ID
          const amazonCampaignId = campaignAmazonId;
          const topSuggestion = suggestions.find((s: Record<string, unknown>) => s.placement === 'top_of_search');
          const productSuggestion = suggestions.find((s: Record<string, unknown>) => s.placement === 'product_page');
          
          if (topSuggestion || productSuggestion) {
            const syncResult: unknown = await amazonApiHelper.syncPlacementAdjustmentToAmazon(
              config.accountId,
              amazonCampaignId,
              // @ts-expect-error Amazon API response type flexibility
              topSuggestion?.suggestedMultiplier || campaign.placementTopSearchBidAdjustment || 0,
              // @ts-expect-error Amazon API response type flexibility
              productSuggestion?.suggestedMultiplier || campaign.placementProductPageBidAdjustment || 0,
              `位置优化: Top=${topSuggestion?.suggestedMultiplier || 0}%, Product=${productSuggestion?.suggestedMultiplier || 0}%`
            );
            // @ts-expect-error Legacy code type compatibility
            placementSyncSuccess = syncResult;
          }
        } catch (apiError: unknown) {
          placementSyncError = (apiError as Error).message;
          // @ts-expect-error Amazon API response type flexibility
          log.warn(`[PlacementOptimization] Amazon API同步失败 (Campaign ${campaign.campaignName}):`, (apiError as Error).message);
        }
        
        // v134: 将同步状态回写到该campaign的所有detail中
        for (const d of details.filter(d => d.localCampaignId === campaignLocalId)) {
          d.apiSyncStatus = placementSyncSuccess ? 'synced' : (placementSyncError ? 'failed' : 'pending');
          d.apiSyncDetail = placementSyncError ? JSON.stringify({ error: placementSyncError }) : null;
        // @ts-expect-error Legacy code type compatibility
        }
        
        // v166: 注册位置倾斜验证任务
        if (placementSyncSuccess) {
          try {
            // v186: 验证任务中也使用正确的Amazon Campaign ID
            const amazonCampaignIdForVerify = campaignAmazonId;
            const topSuggestion = suggestions?.find((s: Record<string, unknown>) => s.placement === 'top_of_search');
            const productSuggestion = suggestions?.find((s: Record<string, unknown>) => s.placement === 'product_page');
            postOptVerifier.schedulePlacementVerification(
              config.accountId,
              [{
                localCampaignId: campaignLocalId,
                amazonCampaignId: amazonCampaignIdForVerify,
                // @ts-expect-error Conditional type narrowing
                expectedTopOfSearch: topSuggestion?.suggestedMultiplier,
                // @ts-expect-error Conditional type narrowing
                expectedProductPage: productSuggestion?.suggestedMultiplier,
              }]
            );
          } catch (verifyErr: unknown) {
            log.warn(`[PlacementOptimization] v166: 注册验证任务失败(不影响主流程): ${(verifyErr as Error).message}`);
          }
        }
      }
    } catch (error: unknown) {
      details.push({
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
        // @ts-expect-error Amazon API response type flexibility
        campaignName: campaign.campaignName,
        error: (error as Error).message,
      });
    }
  }
  
  return { executed: true, adjustmentsCount: dryRun ? details.length : adjustmentsCount, details };
}

/**
 * 执行分时竞价优化
 */
