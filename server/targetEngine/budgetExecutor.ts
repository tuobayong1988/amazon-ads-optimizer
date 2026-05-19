/**
 * v362: 优化目标引擎 - budgetExecutor
 * 从 optimizationTargetEngine.ts 拆分
 * 
 * 包含函数: executeBudgetAllocation
 * 
 * v756: 重构预算执行逻辑
 * - 优先使用budgetPortfolioOptimizer的ROAS导向独立调整结果
 * - 仅当portfolioOptimizer失败时才回退到intelligentBudgetAllocationService
 * - 不再同时调用两个优化器
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
import { isBudgetInCooldown } from '../optimization/gradualOptimizationEngine';
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
    // v756: 预算优化策略重构
    // 优先使用budgetPortfolioOptimizer（v756 ROAS导向独立调整）
    // 仅当portfolioOptimizer失败时才回退到intelligentBudgetAllocationService
    // 不再同时调用两个优化器

    // v756: 整体冷却期检查 — 如果优化目标下所有campaign均在冷却期内，直接跳过
    let allInCooldown = true;
    for (const c of campaigns) {
      // @ts-ignore Dynamic property access
      if (!isBudgetInCooldown(c.lastOptimizedAt)) {
        allInCooldown = false;
        break;
      }
    }
    if (allInCooldown && campaigns.length > 0) {
      log.info(`[BudgetAllocation] v756: 所有${campaigns.length}个campaign均在48小时冷却期内，跳过本次预算优化`);
      return { executed: true, adjustmentsCount: 0, details: [{ skipped: true, reason: '所有campaign均在48小时冷却期内' }] };
    }

    let portfolioResult: Awaited<ReturnType<typeof optimizeBudgetPortfolio>> = null;
    let usePortfolio = false;

    try {
      // v756: 不传递totalBudgetOverride，每个campaign独立评估
      portfolioResult = await optimizeBudgetPortfolio(
        config.accountId,
        config.id
      );
      if (portfolioResult && portfolioResult.allocations.length > 0) {
        usePortfolio = true;
        log.info(`[BudgetAllocation] v756: budgetPortfolioOptimizer成功(ROAS导向), ${portfolioResult.allocations.length}条分配, 算法=${portfolioResult.algorithmUsed}`);
      }
    } catch (portfolioErr: unknown) {
      log.warn(`[BudgetAllocation] v756: budgetPortfolioOptimizer失败，回退到intelligentBudgetAllocationService: ${(portfolioErr as Error).message}`);
    }

    if (usePortfolio && portfolioResult) {
      // ========== v756: 主路径 — 使用budgetPortfolioOptimizer的ROAS导向结果 ==========
      log.info(`[BudgetAllocation] v756: 使用主路径(ROAS导向独立调整), ${portfolioResult.allocations.length}个campaign`);
      
      for (const allocation of portfolioResult.allocations) {
        // 查找对应的campaign对象
        // @ts-ignore Dynamic property access
        const campaign = campaigns.find((c: any) => String(c.campaignId) === String(allocation.campaignId) || String(c.id) === String(allocation.campaignId));
        
        const currentBudget = allocation.currentBudget;
        const finalBudget = allocation.optimalBudget;
        const changeAmount = finalBudget - currentBudget;
        const changePercent = currentBudget > 0 ? (changeAmount / currentBudget * 100) : 0;
        
        const adjustment: Record<string, unknown> = {
          accountId: config.accountId,
          campaignId: allocation.campaignId,
          amazonCampaignId: campaign ? getCampaignAmazonId(campaign) : allocation.campaignId,
          campaignName: allocation.campaignName,
          currentBudget,
          suggestedBudget: finalBudget,
          changeAmount,
          changePercent: changePercent.toFixed(2),
          reason: `[v756-ROAS导向] ${allocation.changePercent > 0 ? '提预算' : allocation.changePercent < 0 ? '降预算' : '保持'}`,
          algorithmUsed: 'roas_guided_reallocation',
          apiSyncStatus: 'pending',
        };
        
        details.push(adjustment);
        
        // v756: 调整金额低于$0.50时跳过API同步
        if (!dryRun && Math.abs(changeAmount) <= 0.50) {
          adjustment.apiSyncStatus = 'not_applicable';
          adjustment.apiSyncDetail = JSON.stringify({ reason: `调整金额$${Math.abs(changeAmount).toFixed(2)}低于$0.50阈值，无需同步` });
          continue;
        }
        
        if (!dryRun && Math.abs(changeAmount) > 0.50) {
          try {
            const amazonCampaignId = campaign ? getCampaignAmazonId(campaign) : allocation.campaignId;
            const budgetSyncResult = await amazonApiHelper.syncBudgetAdjustmentToAmazon(
              config.accountId,
              amazonCampaignId,
              finalBudget,
              `v756-ROAS导向预算优化: $${currentBudget.toFixed(2)} -> $${finalBudget.toFixed(2)} (${changePercent > 0 ? '+' : ''}${changePercent.toFixed(1)}%)`
            );
            
            if (budgetSyncResult) {
              // API成功后才更新本地DB
              const localCampaignId = campaign ? getCampaignLocalId(campaign) : Number(allocation.campaignId);
              await db.updateCampaign(localCampaignId, { 
                dailyBudget: finalBudget.toFixed(2),
                lastOptimizedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
                pendingBudget: finalBudget.toFixed(2),
                budgetSyncStatus: 'pending_confirmation',
              } as Record<string, unknown>);
              adjustmentsCount++;
              adjustment.apiSyncStatus = 'synced';
              
              // 注册预算验证任务
              try {
                postOptVerifier.scheduleBudgetVerification(
                  config.accountId,
                  [{
                    localCampaignId,
                    amazonCampaignId,
                    expectedBudget: finalBudget,
                  }]
                );
              } catch (verifyErr: unknown) {
                log.warn(`[BudgetAllocation] v756: 注册验证任务失败(不影响主流程): ${(verifyErr as Error).message}`);
              }
            } else {
              adjustment.apiSyncStatus = 'failed';
              log.warn(`[BudgetAllocation] v756: API同步失败，跳过DB更新 (Campaign ${allocation.campaignName})`);
            }
          } catch (apiError: unknown) {
            adjustment.apiSyncStatus = 'failed';
            adjustment.apiSyncDetail = JSON.stringify({ error: (apiError as Error).message });
            log.warn(`[BudgetAllocation] v756: API同步失败，跳过DB更新 (Campaign ${allocation.campaignName}):`, (apiError as Error).message);
          }
        }
      }
    } else {
      // ========== 回退路径 — 使用intelligentBudgetAllocationService ==========
      log.warn(`[BudgetAllocation] v756: 使用回退路径(intelligentBudgetAllocationService)`);
      
      // v756: 回退路径不再传递config.dailyBudget作为targetTotalBudget
      // 避免将优化目标的日花费上限误用为分配总池
      const budgetResult = await intelligentBudgetAllocationService.generateBudgetAllocationSuggestions(
        config.id
        // v756: 不传递budgetConfig，使用默认配置，避免totalBudget语义错误
      );
      
      log.info(`[BudgetAllocation] v756回退路径: 目标${config.id} 生成${budgetResult.suggestions.length}条预算建议, campaigns=${campaigns.length}`);
      
      for (const suggestion of budgetResult.suggestions) {
        // @ts-ignore Dynamic property access
        const campaign = campaigns.find(c => c.id === suggestion.campaignId);
        if (!campaign) {
          log.warn(`[BudgetAllocation] v756: suggestion.campaignId=${suggestion.campaignId} 未在campaigns列表中找到匹配`);
          continue;
        }
        
        // v756: 应用渐进式预算调整，但增加额外安全约束
        let finalBudget = suggestion.suggestedBudget;
        // @ts-ignore - type assertion
        const twMetrics = (suggestion as unknown)?.timeWeightedMetrics;
        
        if (twMetrics && Math.abs(suggestion.suggestedBudget - suggestion.currentBudget) > 0.50) {
          const gradualResult = gradualEngine.applyGradualBudgetAdjustment(
            suggestion.currentBudget,
            twMetrics.weightedDailySpend || suggestion.currentBudget,
            suggestion.suggestedBudget,
            twMetrics
          );
          // @ts-ignore Legacy code type compatibility
          finalBudget = gradualResult.gradualBudget;
        }
        
        // v756: 回退路径额外安全约束 — 最低预算保护$5
        const minBudget = Math.max(5.00, suggestion.currentBudget * 0.80);
        finalBudget = Math.max(finalBudget, minBudget);
        // v756: 单次最大降幅5%
        if (finalBudget < suggestion.currentBudget * 0.95) {
          finalBudget = Math.round(suggestion.currentBudget * 0.95 * 100) / 100;
        }
        // v756: 单次最大提幅5%
        if (finalBudget > suggestion.currentBudget * 1.05) {
          finalBudget = Math.round(suggestion.currentBudget * 1.05 * 100) / 100;
        }
        
        const changeAmount = finalBudget - suggestion.currentBudget;
        
        const adjustment: Record<string, unknown> = {
          accountId: config.accountId,
          campaignId: suggestion.campaignId,
          amazonCampaignId: suggestion.amazonCampaignId,
          // @ts-ignore Amazon API response type flexibility
          campaignName: campaign.campaignName,
          currentBudget: suggestion.currentBudget,
          suggestedBudget: finalBudget,
          changeAmount,
          changePercent: ((changeAmount) / suggestion.currentBudget * 100).toFixed(2),
          reason: `[v756回退+安全约束] ${suggestion.reasons?.join(', ') || ''}`,
          algorithmUsed: 'budget_allocator_fallback',
          apiSyncStatus: 'pending',
        };
        
        details.push(adjustment);
        
        if (!dryRun && Math.abs(changeAmount) <= 0.50) {
          adjustment.apiSyncStatus = 'not_applicable';
          adjustment.apiSyncDetail = JSON.stringify({ reason: `调整金额$${Math.abs(changeAmount).toFixed(2)}低于$0.50阈值，无需同步` });
          continue;
        }
        
        if (!dryRun && Math.abs(changeAmount) > 0.50) {
          try {
            const amazonCampaignId = suggestion.amazonCampaignId || getCampaignAmazonId(campaign);
            const budgetSyncResult = await amazonApiHelper.syncBudgetAdjustmentToAmazon(
              config.accountId,
              amazonCampaignId,
              finalBudget,
              `v756回退路径预算优化: $${suggestion.currentBudget.toFixed(2)} -> $${finalBudget.toFixed(2)}`
            );
            
            if (budgetSyncResult) {
              await db.updateCampaign(suggestion.campaignId, { 
                dailyBudget: finalBudget.toFixed(2),
                lastOptimizedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
                pendingBudget: finalBudget.toFixed(2),
                budgetSyncStatus: 'pending_confirmation',
              } as Record<string, unknown>);
              adjustmentsCount++;
              adjustment.apiSyncStatus = 'synced';
              
              try {
                postOptVerifier.scheduleBudgetVerification(
                  config.accountId,
                  [{
                    localCampaignId: suggestion.campaignId,
                    amazonCampaignId: suggestion.amazonCampaignId || amazonCampaignId,
                    expectedBudget: finalBudget,
                  }]
                );
              } catch (verifyErr: unknown) {
                log.warn(`[BudgetAllocation] v756: 注册验证任务失败(不影响主流程): ${(verifyErr as Error).message}`);
              }
            } else {
              adjustment.apiSyncStatus = 'failed';
              // @ts-ignore Amazon API response type flexibility
              log.warn(`[BudgetAllocation] v756: API同步失败，跳过DB更新 (Campaign ${campaign.campaignName})`);
            }
          } catch (apiError: unknown) {
            adjustment.apiSyncStatus = 'failed';
            adjustment.apiSyncDetail = JSON.stringify({ error: (apiError as Error).message });
            // @ts-ignore Amazon API response type flexibility
            log.warn(`[BudgetAllocation] v756: API同步失败，跳过DB更新 (Campaign ${campaign.campaignName}):`, (apiError as Error).message);
          }
        }
      }
    }
  } catch (error: unknown) {
    details.push({ error: (error as Error).message });
  }
  
  // v756: 预算分配汇总诊断日志
  const budgetApplied = details.filter(d => d.apiSyncStatus === 'synced').length;
  const budgetNotApplicable = details.filter(d => d.apiSyncStatus === 'not_applicable').length;
  const budgetFailed = details.filter(d => d.apiSyncStatus === 'failed').length;
  const budgetHold = details.filter(d => Math.abs(Number(d.changeAmount) || 0) < 0.01).length;
  log.info(`[BudgetAllocation] v756诊断汇总: 共${details.length}条, 已应用=${budgetApplied}, 保持不变=${budgetHold}, 低于阈值=${budgetNotApplicable}, 失败=${budgetFailed}`);
  
  return { executed: true, adjustmentsCount: dryRun ? details.length : adjustmentsCount, details };
}

/**
 * 执行投放词状态变更
 */
