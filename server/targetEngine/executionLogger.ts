/**
 * v362: 优化目标引擎 - executionLogger
 * 从 optimizationTargetEngine.ts 拆分
 * 
 * 包含函数: recordExecutionLog
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

export async function recordExecutionLog(result: OptimizationExecutionResult): Promise<void> {
  // v250: 修复架构级BUG — recordExecutionLog之前直接insert到optimizationLogs表，
  // 绕过了createOptimizationLog()中的双写机制，导致optimization_events表缺失NextGen算法的出价记录。
  // 现在统一使用db.createOptimizationLog()，确保每条日志同时写入optimization_logs和optimization_events。
  
  try {
    const now = new Date().toISOString();
    
    // v140+v250: 记录出价调整日志（使用createOptimizationLog确保双写）
    if (result.bidOptimization.executed && result.bidOptimization.adjustmentsCount > 0) {
      log.debug(`[recordExecutionLog] v250: 出价调整日志(双写): details=${result.bidOptimization.details.length}`);
      
      for (const detail of result.bidOptimization.details) {
        // v335: 将safety_pause和safety_summary记录到单独的logCategory，避免污染bid_adjustment日志
        if (detail.action === 'safety_pause' || detail.action === 'safety_summary') {
          try {
            // @ts-expect-error - runtime type mismatch
            await db.createOptimizationLog({
              performanceGroupId: result.targetId,
              performanceGroupName: result.targetName,
              accountId: result.accountId || detail.accountId || 0,
              logCategory: 'safety_check',
              actionType: detail.action === 'safety_summary' ? 'safety_summary' : 'safety_pause',
              campaignId: detail.localCampaignId,
              campaignName: detail.campaignName,
              actionDetail: JSON.stringify(detail),
              previousValue: null,
              newValue: null,
              changeReason: detail.reason || `安全检查`,
              status: 'success',
              apiSyncStatus: 'not_applicable',
              createdAt: now,
              executedAt: now,
            } as Record<string, any>);
          } catch (safetyLogErr: unknown) {
            log.error(`[recordExecutionLog] v335: 安全检查日志写入失败: ${(safetyLogErr as Error).message}`);
          }
          continue; // 跳过后续的bid_adjustment日志写入
        }
        
        const itemSyncStatus = detail.apiSyncStatus || 'pending';
        const itemSyncDetail = detail.apiSyncDetail || null;
        
        let itemErrorMessage: string | null = null;
        if (itemSyncStatus === 'failed' && itemSyncDetail) {
          try {
            const parsed = JSON.parse(itemSyncDetail);
            itemErrorMessage = parsed.error || null;
          } catch (e) {
            itemErrorMessage = null;
          }
        }
        
        try {
          // v357: 增强出价调整日志 - 添加Amazon ID追踪信息
          const enhancedBidDetail = {
            ...detail,
            v357_amazonKeywordId: detail.amazonKeywordId || detail.keywordId || '',
            v357_amazonCampaignId: detail.amazonCampaignId || '',
          };
          // @ts-expect-error - runtime type mismatch
          await db.createOptimizationLog({
            performanceGroupId: result.targetId,
            performanceGroupName: result.targetName,
            accountId: result.accountId || detail.accountId || 0,
            logCategory: 'bid_adjustment',
            actionType: (detail.newBid ?? 0) > (detail.currentBid ?? 0) ? 'bid_increase' : 'bid_decrease',
            campaignId: detail.localCampaignId,
            campaignName: detail.campaignName,
            actionDetail: JSON.stringify(enhancedBidDetail),  // v357: 使用增强后的detail
            previousValue: `${(typeof detail.currentBid === 'number' ? detail.currentBid : 0).toFixed(2)}`,
            newValue: `${(typeof detail.newBid === 'number' ? detail.newBid : 0).toFixed(2)}`,
            changeReason: detail.reason || `出价调整 ${detail.changePercent || '0'}%`,
            status: itemSyncStatus === 'synced' ? 'success' : itemSyncStatus === 'failed' ? 'failed' : 'success',
            apiSyncStatus: itemSyncStatus,
            apiSyncDetail: itemSyncDetail,
            apiSyncedAt: itemSyncStatus === 'synced' ? now : null,
            errorMessage: itemErrorMessage,
            createdAt: now,
            executedAt: now,
            // v258: 传递结构化归因和护栏信息
            reasonDetails: detail.reasonDetails ? JSON.stringify(detail.reasonDetails) : undefined,
            guardrailInfo: detail.guardrailInfo ? JSON.stringify(detail.guardrailInfo) : undefined,
          } as Record<string, any>);
        } catch (insertError: unknown) {
          log.error(`[recordExecutionLog] 出价日志写入失败: ${(insertError as Error).message}`, { keywordId: detail.keywordId, itemSyncStatus });
        }
      }
    }
    
    // v250: 记录位置调整日志（使用createOptimizationLog确保双写）
    if (result.placementOptimization.executed && result.placementOptimization.adjustmentsCount > 0) {
      for (const detail of result.placementOptimization.details) {
        await db.createOptimizationLog({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          accountId: result.accountId || detail.accountId || 0, // v167: 优先使用result.accountId
          logCategory: 'placement_adjustment',
          actionType: 'placement_adjust',
          campaignId: detail.localCampaignId,
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(detail),
          previousValue: detail.previousValue || `${detail.placement}: ${detail.currentMultiplier}%`,
          newValue: detail.newValue || `${detail.placement}: ${detail.suggestedMultiplier}%`,
          changeReason: detail.reason || `位置优化: ${detail.placement} ${detail.currentMultiplier}% → ${detail.suggestedMultiplier}%`,
          status: detail.apiSyncStatus === 'synced' ? 'success' : detail.apiSyncStatus === 'failed' ? 'failed' : 'success',
          apiSyncStatus: detail.apiSyncStatus || 'not_applicable',
          apiSyncDetail: detail.apiSyncDetail || null,
          apiSyncedAt: detail.apiSyncStatus === 'synced' ? now : null,
          createdAt: now,
          executedAt: now,
        });
      }
    }
    
    // v250+v2: 记录搜索词分析日志（使用createOptimizationLog确保双写）
    if (result.searchTermAnalysis.executed) {
      for (const detail of result.searchTermAnalysis.details) {
        // v353: 完善action_type映射 - 为所有action类型分配正确的action_type
        // 旧版本将brand_protect_skip/exploration_protect_skip等错误归类为keyword_create
        const actionTypeMap: Record<string, string> = {
          'add_negative': 'negative_keyword_add',
          'add_negative_product_target': 'negative_product_target_add',
          'brand_protect_skip': 'search_term_brand_protect',
          'exploration_protect_skip': 'search_term_exploration_protect',
          'keyword_permanently_failed_skip': 'search_term_permanent_fail_skip',
          'keyword_validation_failed': 'search_term_validation_fail',
          'add_product_target': 'product_target_create',
          'add_keyword': 'keyword_create',
        };
        const actionType = actionTypeMap[detail.action] || 'keyword_create';
        // v357: 增强日志 - 在action_detail中添加Amazon ID追踪信息
        const enhancedDetail = {
          ...detail,
          // v357: 明确记录尝试创建的文本和目标广告组/活动
          v357_targetText: detail.searchTerm || detail.keyword || '',
          v357_targetAdGroupId: detail.adGroupId || detail.targetAdGroupId || '',
          v357_targetCampaignId: detail.campaignId || detail.localCampaignId || '',
          v357_amazonKeywordId: detail.amazonKeywordId || detail.createdKeywordId || '',
          v357_amazonTargetId: detail.amazonTargetId || detail.createdTargetId || '',
        };
        await db.createOptimizationLog({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          accountId: result.accountId || detail.accountId || 0,
          logCategory: 'optimization_settings',
          // @ts-expect-error - type assertion
          actionType: actionType as unknown,
          campaignId: detail.localCampaignId,
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(enhancedDetail),  // v357: 使用增强后的detail
          previousValue: '',
          newValue: detail.searchTerm || '',
          changeReason: detail.reason || '',
          status: detail.apiSyncStatus === 'synced' ? 'success' : detail.apiSyncStatus === 'failed' ? 'failed' : 'success',
          apiSyncStatus: detail.apiSyncStatus || 'not_applicable',
          apiSyncDetail: detail.apiSyncDetail || null,
          apiSyncedAt: detail.apiSyncStatus === 'synced' ? now : null,
          createdAt: now,
          executedAt: now,
        });
      }
    }
    
    // v250: 记录分时竞价日志（使用createOptimizationLog确保双写）
    if (result.daypartingOptimization.executed && result.daypartingOptimization.adjustmentsCount > 0) {
      for (const detail of result.daypartingOptimization.details) {
        await db.createOptimizationLog({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          accountId: result.accountId || detail.accountId || 0, // v167: 优先使用result.accountId
          logCategory: 'bid_adjustment',
          actionType: 'dayparting_bid',
          campaignId: detail.localCampaignId,
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(detail),
          // v175: 不再带$符号存储
          previousValue: `${detail.baseBid?.toFixed(2) || '0.00'}`,
          newValue: `${detail.adjustedBid?.toFixed(2) || '0.00'}`,
          changeReason: detail.reason || `分时竞价: ${detail.hour}:00 乘数${detail.bidMultiplier}x`,
          status: detail.apiSyncStatus === 'synced' ? 'success' : detail.apiSyncStatus === 'failed' ? 'failed' : 'success',
          apiSyncStatus: detail.apiSyncStatus || 'not_applicable',
          apiSyncDetail: detail.apiSyncDetail || null,
          apiSyncedAt: detail.apiSyncStatus === 'synced' ? now : null,
          createdAt: now,
          executedAt: now,
        });
      }
    }
    
    // v250: 记录预算分配日志（使用createOptimizationLog确保双写）
    if (result.budgetAllocation.executed && result.budgetAllocation.adjustmentsCount > 0) {
      for (const detail of result.budgetAllocation.details) {
        await db.createOptimizationLog({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          accountId: result.accountId || detail.accountId || 0, // v167: 优先使用result.accountId
          logCategory: 'bid_adjustment',
          actionType: 'budget_adjustment',
          campaignId: detail.localCampaignId,
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(detail),
          // v175: 不再带$符号存储，避免AutoCorrector解析NaN
          previousValue: `${detail.currentBudget?.toFixed(2) || '0.00'}`,
          newValue: `${detail.suggestedBudget?.toFixed(2) || '0.00'}`,
          changeReason: detail.reason || `预算调整 ${detail.changePercent}%`,
          status: detail.apiSyncStatus === 'synced' ? 'success' : detail.apiSyncStatus === 'failed' ? 'failed' : 'success',
          apiSyncStatus: detail.apiSyncStatus || 'not_applicable',
          apiSyncDetail: detail.apiSyncDetail || null,
          apiSyncedAt: detail.apiSyncStatus === 'synced' ? now : null,
          createdAt: now,
          executedAt: now,
        });
      }
    }
    
    // v250: 记录分时预算日志（使用createOptimizationLog确保双写）
    if (result.daypartingBudgetOptimization?.executed && result.daypartingBudgetOptimization.adjustmentsCount > 0) {
      for (const detail of result.daypartingBudgetOptimization.details) {
        if (detail.error) continue;
        await db.createOptimizationLog({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          accountId: result.accountId || detail.accountId || 0,
          logCategory: 'bid_adjustment',
          actionType: 'budget_adjustment',
          campaignId: detail.localCampaignId,
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(detail),
          previousValue: `${detail.currentBudget?.toFixed(2) || '0.00'}`,
          newValue: `${detail.adjustedBudget?.toFixed(2) || '0.00'}`,
          changeReason: detail.reason || `分时预算: 星期${detail.dayOfWeek} 倍数${detail.budgetMultiplier}x`,
          status: detail.apiSyncStatus === 'synced' ? 'success' : detail.apiSyncStatus === 'failed' ? 'failed' : 'success',
          apiSyncStatus: detail.apiSyncStatus || 'not_applicable',
          apiSyncDetail: detail.apiSyncDetail || null,
          apiSyncedAt: detail.apiSyncStatus === 'synced' ? now : null,
          createdAt: now,
          executedAt: now,
        });
      }
    }
    
    // v250: 记录投放词状态变更日志（使用createOptimizationLog确保双写）
    if (result.keywordStatusChanges.executed) {
      for (const detail of result.keywordStatusChanges.details) {
        await db.createOptimizationLog({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          accountId: result.accountId || detail.accountId || 0, // v167: 优先使用result.accountId
          logCategory: 'bid_adjustment',
          actionType: detail.action === 'add_negative' ? 'negative_keyword_add' : detail.newStatus === 'paused' ? 'target_pause' : 'target_enable',
          campaignId: detail.localCampaignId,
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(detail),
          previousValue: detail.currentStatus || '',
          newValue: detail.action || '',
          changeReason: detail.reason || '',
          status: detail.apiSyncStatus === 'synced' ? 'success' : detail.apiSyncStatus === 'failed' ? 'failed' : 'success',
          apiSyncStatus: detail.apiSyncStatus || 'not_applicable',
          apiSyncDetail: detail.apiSyncDetail || null,
          apiSyncedAt: detail.apiSyncStatus === 'synced' ? now : null,
          createdAt: now,
          executedAt: now,
        });
      }
    }
    
    // v250: 记录广告活动状态变更日志（使用createOptimizationLog确保双写）
    if (result.campaignStatusChanges.executed) {
      for (const detail of result.campaignStatusChanges.details) {
        if (detail.error) continue;
        await db.createOptimizationLog({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          accountId: result.accountId || detail.accountId || 0, // v167: 优先使用result.accountId
          logCategory: 'bid_adjustment',
          actionType: detail.newStatus === 'paused' ? 'bid_decrease' : 'bid_increase',
          campaignId: detail.localCampaignId,
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(detail),
          previousValue: detail.previousStatus || '',
          newValue: detail.newStatus || '',
          changeReason: detail.reason || '',
          status: detail.apiSyncStatus === 'synced' ? 'success' : detail.apiSyncStatus === 'failed' ? 'failed' : 'success',
          apiSyncStatus: detail.apiSyncStatus || 'not_applicable',
          apiSyncDetail: detail.apiSyncDetail || null,
          apiSyncedAt: detail.apiSyncStatus === 'synced' ? now : null,
          createdAt: now,
          executedAt: now,
        });
      }
    }
    
    // v250: 记录广告组状态变更日志（使用createOptimizationLog确保双写）
    if (result.adGroupStatusChanges.executed) {
      for (const detail of result.adGroupStatusChanges.details) {
        if (detail.error) continue;
        await db.createOptimizationLog({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          accountId: result.accountId || detail.accountId || 0, // v167: 优先使用result.accountId
          logCategory: 'optimization_settings',
          actionType: detail.action === 'pause' ? 'adgroup_pause' : 'adgroup_enable',
          campaignId: detail.localCampaignId,
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(detail),
          previousValue: detail.currentStatus || '',
          newValue: detail.newStatus || '',
          changeReason: detail.reason || `广告组 "${detail.adGroupName}" ${detail.action === 'pause' ? '暂停' : '启用'}`,
          status: detail.apiSyncStatus === 'synced' ? 'success' : detail.apiSyncStatus === 'failed' ? 'failed' : 'success',
          apiSyncStatus: detail.apiSyncStatus || 'not_applicable',
          apiSyncDetail: detail.apiSyncDetail || null,
          apiSyncedAt: detail.apiSyncStatus === 'synced' ? now : null,
          createdAt: now,
          executedAt: now,
        });
      }
    }
    
    // v139+v250: 更新优化目标的 last_optimization_at 时间戳
    try {
      const dbInstance = await db.getDb();
      const { performanceGroups } = await import('../../drizzle/schema');
      const { eq: eqOp } = await import('drizzle-orm');
      await dbInstance!.update(performanceGroups)
        .set({ lastOptimizationAt: new Date() } as Record<string, any>)
        .where(eqOp(performanceGroups.id, result.targetId));
      log.info(`[OptimizationTargetEngine] 已更新 last_optimization_at: targetId=${result.targetId}`);
    } catch (updateErr: unknown) {
      // v350: 使用连接池获取直接连接，替代独立createConnection
      try {
        const directConn = await db.getDirectConnection();
        try {
          await directConn.execute(
            'UPDATE performance_groups SET last_optimization_at = NOW() WHERE id = ?',
            [result.targetId]
          );
          log.info(`[OptimizationTargetEngine] 已通过连接池更新 last_optimization_at: targetId=${result.targetId}`);
        } finally {
          directConn.release(); // v350: 归还连接到池
        }
      } catch (directErr: unknown) {
        log.error(`[OptimizationTargetEngine] 更新last_optimization_at失败: ${(directErr as Error).message}`);
      }
    }
    
    log.info(`[OptimizationTargetEngine] 执行日志已写入数据库: ${result.targetName}`, {
      status: result.status,
      bidAdjustments: result.bidOptimization.adjustmentsCount,
      placementAdjustments: result.placementOptimization.adjustmentsCount,
      negativeKeywords: result.searchTermAnalysis.negativeKeywordsAdded,
      newKeywords: result.searchTermAnalysis.newKeywordsAdded,
      keywordsPaused: result.keywordStatusChanges.pausedCount,
      keywordsEnabled: result.keywordStatusChanges.enabledCount,
      campaignsPaused: result.campaignStatusChanges.pausedCount,
      campaignsEnabled: result.campaignStatusChanges.enabledCount,
      adGroupsPaused: result.adGroupStatusChanges.pausedCount,
      adGroupsEnabled: result.adGroupStatusChanges.enabledCount,
    });
  } catch (error: unknown) {
    log.error(`[OptimizationTargetEngine] 日志写入失败:`, (error as Error).message);
    // 回退到console.log
    log.info(`[OptimizationTargetEngine] 执行完成(日志回退): ${result.targetName}`, {
      status: result.status,
      errors: result.errors.length,
    });
  }
}

/**
 * 获取所有启用的优化目标
 */
