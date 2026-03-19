/**
 * v362: 优化目标引擎 - budgetExecutor
 * 从 optimizationTargetEngine.ts 拆分
 * 
 * 包含函数: executeBudgetAllocation
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

export async function executeBudgetAllocation(
  config: OptimizationTargetConfig,
  campaigns: unknown[],
  dryRun: boolean
): Promise<{ executed: boolean; adjustmentsCount: number; details: Record<string, unknown>[] }> {
  const details: Record<string, unknown>[] = [];
  let adjustmentsCount = 0;
  
  try {
    // v360: 统一预算分配机制
    // 优先使用budgetPortfolioOptimizer（基于边际效用的凸优化算法）
    // 回退到intelligentBudgetAllocationService（多维度评分算法）
    let portfolioResult: Awaited<ReturnType<typeof optimizeBudgetPortfolio>> = null;
    try {
      portfolioResult = await optimizeBudgetPortfolio(
        config.accountId,
        config.id,
        config.dailyBudget || undefined
      );
      if (portfolioResult) {
        log.info(`[BudgetAllocation] v360: budgetPortfolioOptimizer成功, ${portfolioResult.allocations.length}条分配, 总预算=$${portfolioResult.totalBudget}`);
      }
    } catch (portfolioErr: unknown) {
      log.warn(`[BudgetAllocation] v360: budgetPortfolioOptimizer失败，回退到intelligentBudgetAllocationService: ${(portfolioErr as Error).message}`);
    }
    
    // 获取预算分配建议（回退路径）
    const budgetConfig = config.dailyBudget 
      ? { targetTotalBudget: config.dailyBudget } 
      : undefined;
    const budgetResult = await intelligentBudgetAllocationService.generateBudgetAllocationSuggestions(
      config.id,
      budgetConfig ? { ...intelligentBudgetAllocationService.getDefaultAllocationConfig(), ...budgetConfig } : undefined
    );
    
    // v353: 预算分配诊断日志
    log.info(`[BudgetAllocation] v353诊断: 目标${config.id} 生成${budgetResult.suggestions.length}条预算建议, campaigns=${campaigns.length}`);
    
    let skippedBelowThreshold = 0;
    let appliedCount = 0;
    
    for (const suggestion of budgetResult.suggestions) {
      // v354: P0修复 — suggestion.campaignId现在是本地ID，与campaigns.id匹配
      const campaign = campaigns.find(c => c.id === suggestion.campaignId);
      if (!campaign) {
        // v354: 诊断日志 — 记录未匹配的campaign
        log.warn(`[BudgetAllocation] v354: suggestion.campaignId=${suggestion.campaignId} (amazonId=${suggestion.amazonCampaignId}) 未在campaigns列表中找到匹配`);
        continue;
      }
      
      // v163: 应用渐进式预算调整
      let finalBudget = suggestion.suggestedBudget;
      const campaignPerf = budgetResult.suggestions.find(s => s.campaignId === suggestion.campaignId);
      // @ts-expect-error - type assertion
      const twMetrics = (campaignPerf as unknown)?.timeWeightedMetrics;
      
      if (twMetrics && Math.abs(suggestion.suggestedBudget - suggestion.currentBudget) > 0.50) {
        const gradualResult = gradualEngine.applyGradualBudgetAdjustment(
          suggestion.currentBudget,
          twMetrics.weightedDailySpend || suggestion.currentBudget,
          suggestion.suggestedBudget,
          twMetrics
        );
        finalBudget = gradualResult.gradualBudget;
        log.debug(`[BudgetAllocation] v163: 渐进式预算 - Campaign ${campaign.campaignName}: $${suggestion.currentBudget.toFixed(0)}→$${finalBudget.toFixed(0)} (算法目标$${suggestion.suggestedBudget.toFixed(0)}, 订单保护=${gradualResult.orderProtectionActive})`);
      }
      
      const adjustment: Record<string, unknown> = {
        accountId: config.accountId,
        campaignId: suggestion.campaignId, // v354: 本地ID
        amazonCampaignId: suggestion.amazonCampaignId, // v354: Amazon ID
        campaignName: campaign.campaignName,
        currentBudget: suggestion.currentBudget,
        suggestedBudget: finalBudget, // v163: 使用渐进式调整后的预算
        changeAmount: finalBudget - suggestion.currentBudget,
        changePercent: ((finalBudget - suggestion.currentBudget) / suggestion.currentBudget * 100).toFixed(2),
        reason: `[v163渐进] ${suggestion.reasons?.join(', ') || ''}`,
        // @ts-expect-error - dynamic property access
        expectedImpact: (suggestion as Record<string, unknown>).expectedRoasChange || 0,
        algorithmUsed: 'budget_allocator', // v335
        apiSyncStatus: 'pending',
      };
      
      details.push(adjustment);
      
      // v168: 当调整金额低于阈值时，标记为not_applicable而非pending
      // 避免产生大量永远不会被同步的pending记录
      if (!dryRun && Math.abs(finalBudget - suggestion.currentBudget) <= 0.50) {
        adjustment.apiSyncStatus = 'not_applicable';
        adjustment.apiSyncDetail = JSON.stringify({ reason: `调整金额$${Math.abs(finalBudget - suggestion.currentBudget).toFixed(2)}低于$0.50阈值，无需同步` });
      }
      
      if (!dryRun && Math.abs(finalBudget - suggestion.currentBudget) > 0.50) { // v165: 降低API调用阈值从$1到$0.50
        // v148: 先调Amazon API确认成功，再更新本地数据库（先API后DB原则）
        try {
          // v354: 使用suggestion中的amazonCampaignId，确保Amazon API调用使用正确的ID
          const amazonCampaignId = suggestion.amazonCampaignId || getCampaignAmazonId(campaign);
          const budgetSyncResult = await amazonApiHelper.syncBudgetAdjustmentToAmazon(
            config.accountId,
            amazonCampaignId,
            finalBudget, // v163: 使用渐进式调整后的预算
            `v163渐进式预算优化: $${suggestion.currentBudget.toFixed(2)} -> $${finalBudget.toFixed(2)}`
          );
          
          if (budgetSyncResult) {
            // API成功后才更新本地DB
            // v166: 同时标记pending状态，等待下次同步确认
            // v354: suggestion.campaignId现在是本地ID，与db.updateCampaign(id: number)匹配
            await db.updateCampaign(suggestion.campaignId, { 
              dailyBudget: finalBudget.toFixed(2),
              lastOptimizedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
              pendingBudget: finalBudget.toFixed(2),
              budgetSyncStatus: 'pending_confirmation',
            } as Record<string, unknown>);
            adjustmentsCount++;
            adjustment.apiSyncStatus = 'synced';
            
            // v166: 注册预算验证任务
            try {
              postOptVerifier.scheduleBudgetVerification(
                config.accountId,
                [{
                  localCampaignId: suggestion.campaignId, // v354: 现在正确传入本地ID
                  amazonCampaignId: suggestion.amazonCampaignId || amazonCampaignId, // v354: 使用Amazon ID
                  expectedBudget: finalBudget,
                }]
              );
            } catch (verifyErr: unknown) {
              log.warn(`[BudgetAllocation] v166: 注册验证任务失败(不影响主流程): ${(verifyErr as Error).message}`);
            }
          } else {
            // API返回false，不更新本地DB
            adjustment.apiSyncStatus = 'failed';
            log.warn(`[BudgetAllocation] v148: API同步失败，跳过DB更新 (Campaign ${campaign.campaignName})`);
          }
        } catch (apiError: unknown) {
          // API异常，不更新本地DB，保持数据一致性
          adjustment.apiSyncStatus = 'failed';
          adjustment.apiSyncDetail = JSON.stringify({ error: (apiError as Error).message });
          log.warn(`[BudgetAllocation] v148: API同步失败，跳过DB更新 (Campaign ${campaign.campaignName}):`, (apiError as Error).message);
        }
      }
    }
  } catch (error: unknown) {
    details.push({ error: (error as Error).message });
  }
  
  // v353: 预算分配汇总诊断日志
  const budgetApplied = details.filter(d => d.apiSyncStatus === 'synced').length;
  const budgetNotApplicable = details.filter(d => d.apiSyncStatus === 'not_applicable').length;
  const budgetFailed = details.filter(d => d.apiSyncStatus === 'failed').length;
  log.info(`[BudgetAllocation] v353诊断汇总: 共${details.length}条建议, 已应用=${budgetApplied}, 低于阈值=${budgetNotApplicable}, 失败=${budgetFailed}`);
  
  return { executed: true, adjustmentsCount: dryRun ? details.length : adjustmentsCount, details };
}

/**
 * 执行投放词状态变更
 */
