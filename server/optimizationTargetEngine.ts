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

import * as db from "./db";
import { getDb } from "./db";
import { keywords as keywordsTable, productTargets as productTargetsTable, campaigns as campaignsTable } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import * as bidOptimizer from "./bidOptimizer";
import * as daypartingService from "./daypartingService";
import * as placementOptimizationService from "./placementOptimizationService";
import { preOptimizationSafetyCheck, applyBidGuardrail, applyBudgetGuardrail, applyPlacementGuardrail, SAFETY_LIMITS } from './optimizationSafetyGuardrails';
import * as adAutomation from "./adAutomation";
import * as intelligentBudgetAllocationService from "./intelligentBudgetAllocationService";
import * as bidCoordinator from "./services/bidCoordinator";
import * as amazonApiHelper from "./services/amazonApiHelper";
import { acquireAccountOptimizationLock, releaseAccountOptimizationLock } from "./dataSyncScheduler";
import * as amazonIdResolver from "./services/amazonIdResolver";
import { getLocalHour, getLocalDayOfWeek, isNewKeyword, getExplorationStrategy, isProtectedKeyword } from "./algorithmUtils";
import * as campaignLifecycleService from "./services/campaignLifecycleService";
import * as timeDecayService from "./timeDecayWeightedDataService";
import * as gradualEngine from "./gradualOptimizationEngine";
import * as selfEvolution from "./selfEvolutionEngine";
import * as multiDimOptimizer from "./multiDimensionOptimizer";
import * as postOptVerifier from "./postOptimizationVerifier";

// 缓存账号站点信息，避免重复查询
const marketplaceCache = new Map<number, string>();

async function getAccountMarketplace(accountId: number): Promise<string> {
  if (marketplaceCache.has(accountId)) return marketplaceCache.get(accountId)!;
  const account = await db.getAdAccountById(accountId);
  const marketplace = account?.marketplace || 'US';
  marketplaceCache.set(accountId, marketplace);
  return marketplace;
}

// 优化执行结果类型
export interface OptimizationExecutionResult {
  targetId: number;
  targetName: string;
  accountId: number; // v167: 添加accountId确保日志记录正确
  executionTime: Date;
  status: 'success' | 'partial' | 'failed' | 'skipped';
  
  // 各优化模块的执行结果
  bidOptimization: {
    executed: boolean;
    adjustmentsCount: number;
    details: any[];
  };
  
  placementOptimization: {
    executed: boolean;
    adjustmentsCount: number;
    details: any[];
  };
  
  daypartingOptimization: {
    executed: boolean;
    adjustmentsCount: number;
    details: any[];
  };
  
  searchTermAnalysis: {
    executed: boolean;
    negativeKeywordsAdded: number;
    newKeywordsAdded: number;
    details: any[];
  };
  
  budgetAllocation: {
    executed: boolean;
    adjustmentsCount: number;
    details: any[];
  };
  
  keywordStatusChanges: {
    executed: boolean;
    pausedCount: number;
    enabledCount: number;
    details: any[];
  };
  
  // v135: 广告活动状态变更
  campaignStatusChanges: {
    executed: boolean;
    pausedCount: number;
    enabledCount: number;
    details: any[];
  };
  
  // v135: 广告组状态变更
  adGroupStatusChanges: {
    executed: boolean;
    pausedCount: number;
    enabledCount: number;
    details: any[];
  };
  
  // 多维度智能优化结果
  multiDimensionOptimization: {
    executed: boolean;
    campaignsAnalyzed: number;
    rulesGenerated: number;
    details: any[];
  };
  
  // 中央竞价协调器执行结果
  bidCoordination: {
    executed: boolean;
    campaignsCoordinated: number;
    circuitBreakerTriggered: number;
    details: any[];
  };
  
  errors: string[];
  warnings: string[];
  
  // v143: 生命周期信息
  lifecycleStage?: string;
  lifecycleSummary?: string;
  
  // v137: 重试队列信息
  retryBatchId?: string;
  retryTaskCount?: number;
}

// 优化目标配置
export interface OptimizationTargetConfig {
  id: number;
  name: string;
  accountId: number;
  marketplace: string; // 站点代码，用于时区感知分时
  isEnabled: boolean;
  
  // 优化目标
  optimizationGoal: 'maximize_sales' | 'target_acos' | 'target_roas' | 'balanced';
  targetAcos?: number;
  targetRoas?: number;
  dailyBudget?: number;
  maxBid?: number;
  
  // 各优化模块的启用状态
  enableBidOptimization: boolean;
  enablePlacementOptimization: boolean;
  enableDaypartingOptimization: boolean;
  enableSearchTermAnalysis: boolean;
  enableBudgetAllocation: boolean;
  enableKeywordAutoExecution: boolean;
  
  // 执行频率设置
  executionFrequency: 'hourly' | 'daily' | 'weekly';
  lastExecutionTime?: Date;
  nextExecutionTime?: Date;
  
  // 安全设置
  maxDailyBidChanges: number;
  maxBidChangePercent: number;
  minDataPoints: number;
  autoRollbackEnabled: boolean;
  
  // v143: 生命周期感知调度
  lifecycleStage?: campaignLifecycleService.LifecycleStage;
  lifecycleConfig?: campaignLifecycleService.LifecycleOptimizationConfig;
  lifecycleSummary?: string;
  
  // v164: 自我进化所需字段
  userId: number;
  strategyTemplateId?: string;
}

/**
 * 获取优化目标的完整配置
 */
export async function getOptimizationTargetConfig(targetId: number): Promise<OptimizationTargetConfig | null> {
  const group = await db.getPerformanceGroupById(targetId);
  if (!group) return null;
  
  const config: OptimizationTargetConfig = {
    id: group.id,
    name: group.name,
    accountId: group.accountId,
    marketplace: await getAccountMarketplace(group.accountId),
    isEnabled: group.status === 'active',
    
    optimizationGoal: (group.optimizationGoal as any) || 'balanced',
    targetAcos: group.targetAcos ? parseFloat(group.targetAcos) : undefined,
    targetRoas: group.targetRoas ? parseFloat(group.targetRoas) : undefined,
    dailyBudget: group.dailyBudget ? parseFloat(group.dailyBudget) : undefined,
    maxBid: group.maxBid ? parseFloat(group.maxBid) : undefined,
    
    // 默认启用所有优化模块
    enableBidOptimization: true,
    enablePlacementOptimization: true,
    enableDaypartingOptimization: true,
    enableSearchTermAnalysis: true,
    enableBudgetAllocation: true,
    enableKeywordAutoExecution: true,
    
    executionFrequency: 'daily',
    // v156: 从数据库恢复上次执行时间
    lastExecutionTime: (group as any).lastOptimizationAt ? new Date((group as any).lastOptimizationAt) : undefined,
    nextExecutionTime: undefined,
    
    maxDailyBidChanges: 100,
    maxBidChangePercent: 30,
    minDataPoints: 7,
    autoRollbackEnabled: true,
    
    // v164: 自我进化所需字段
    userId: (group as any).userId || 0,
    strategyTemplateId: (group as any).strategyTemplateId || undefined,
  };
  
  // v143: 查询生命周期阶段并注入配置
  try {
    const lifecycle = await campaignLifecycleService.getTargetLifecycleStage(group.id);
    config.lifecycleStage = lifecycle.overallStage;
    config.lifecycleConfig = lifecycle.config;
    config.lifecycleSummary = lifecycle.summary;
    
    // 根据生命周期阶段调整安全参数
    config.maxBidChangePercent = lifecycle.config.bid.maxAdjustmentPercent;
    console.log(`[OptimizationTargetConfig] 目标 ${group.name} 生命周期: ${lifecycle.overallStage} (${lifecycle.summary})`);
  } catch (lcErr: any) {
    console.error(`[OptimizationTargetConfig] 生命周期查询失败: ${lcErr.message}`);
  }
  
  return config;
}

/**
 * 执行优化目标的所有优化策略
 */
export async function executeOptimizationTarget(
  targetId: number,
  options: {
    dryRun?: boolean;
    forceExecution?: boolean;
    specificModules?: string[];
  } = {}
): Promise<OptimizationExecutionResult> {
  const { dryRun = false, forceExecution = false, specificModules } = options;
  
  const config = await getOptimizationTargetConfig(targetId);
  if (!config) {
    throw new Error(`优化目标 ${targetId} 不存在`);
  }
  
  if (!config.isEnabled && !forceExecution) {
    throw new Error(`优化目标 ${config.name} 未启用`);
  }
  
  // v148: 获取账户级优化锁，防止与automationExecutionEngine并行冲突
  if (!dryRun && !acquireAccountOptimizationLock(config.accountId, `optimizationTarget:${targetId}`)) {
    throw new Error(`账户 ${config.accountId} 优化锁已被占用，跳过本次执行`);
  }
  const shouldReleaseLock = !dryRun;
  
  const result: OptimizationExecutionResult = {
    targetId: config.id,
    targetName: config.name,
    accountId: config.accountId, // v167: 传递accountId到日志记录
    executionTime: new Date(),
    status: 'success',
    bidOptimization: { executed: false, adjustmentsCount: 0, details: [] },
    placementOptimization: { executed: false, adjustmentsCount: 0, details: [] },
    daypartingOptimization: { executed: false, adjustmentsCount: 0, details: [] },
    searchTermAnalysis: { executed: false, negativeKeywordsAdded: 0, newKeywordsAdded: 0, details: [] },
    budgetAllocation: { executed: false, adjustmentsCount: 0, details: [] },
    keywordStatusChanges: { executed: false, pausedCount: 0, enabledCount: 0, details: [] },
    campaignStatusChanges: { executed: false, pausedCount: 0, enabledCount: 0, details: [] },
    adGroupStatusChanges: { executed: false, pausedCount: 0, enabledCount: 0, details: [] },
    multiDimensionOptimization: { executed: false, campaignsAnalyzed: 0, rulesGenerated: 0, details: [] },
    bidCoordination: { executed: false, campaignsCoordinated: 0, circuitBreakerTriggered: 0, details: [] },
    errors: [],
    warnings: [],
    lifecycleStage: config.lifecycleStage,
    lifecycleSummary: config.lifecycleSummary,
  };
  
  // v143: 记录生命周期阶段信息
  if (config.lifecycleStage) {
    console.log(`[OptimizationTarget] 目标 ${config.name} 当前生命周期: ${config.lifecycleStage} | 出价调整上限: ±${config.maxBidChangePercent}% | ${config.lifecycleSummary}`);
  }
  
  // v162: 执行前安全护栏检查
  try {
    const safetyCheck = await preOptimizationSafetyCheck(config.accountId, targetId);
    if (!safetyCheck.safe) {
      result.warnings.push(...safetyCheck.warnings);
      console.warn(`[OptimizationTarget] v162 安全护栏触发: ${safetyCheck.warnings.join('; ')}`);
      // 紧急制动时不完全阻止执行，但记录警告并降低调整幅度
    }
  } catch (safetyErr: any) {
    console.log(`[OptimizationTarget] v162 安全检查异常，继续执行: ${safetyErr.message}`);
  }
  
  // v164: 自我进化周期 - 在每次优化执行前自动评估上一轮优化效果并学习
  let evolutionReport: any = null;
  let adaptiveParams: any = null;
  try {
    // 运行进化周期：评估效果→学习→自动纠错
    evolutionReport = await selfEvolution.runEvolutionCycle(
      targetId, config.userId, config.accountId, config.strategyTemplateId
    );
    if (evolutionReport) {
      console.log(`[OptimizationTarget] v164 进化周期完成: 评估${evolutionReport.totalActionsEvaluated}个动作, ` +
        `正面${evolutionReport.positiveActions}, 负面${evolutionReport.negativeActions}, ` +
        `纠错${evolutionReport.correctionsExecuted}个, 趋势: ${evolutionReport.improvementTrend}`);
      if (evolutionReport.correctionsExecuted > 0) {
        result.warnings.push(`自我进化: 自动纠正了${evolutionReport.correctionsExecuted}个不合理优化`);
      }
    }
    
    // 获取自适应优化参数（根据历史成功率动态调整）
    adaptiveParams = await selfEvolution.getAdaptiveOptimizationParams(targetId, config.strategyTemplateId);
    if (adaptiveParams) {
      console.log(`[OptimizationTarget] v164 自适应参数: 最大出价提升${Math.round(adaptiveParams.maxBidIncrease * 100)}%, ` +
        `最大出价降低${Math.round(adaptiveParams.maxBidDecrease * 100)}%, ` +
        `成功率${Math.round(adaptiveParams.recentSuccessRate * 100)}%`);
    }
  } catch (evoErr: any) {
    console.log(`[OptimizationTarget] v164 自我进化异常，继续执行: ${evoErr.message}`);
  }
  
  // 获取优化目标下的所有广告活动
  const allCampaigns = await db.getCampaignsByPerformanceGroupId(targetId);
  if (allCampaigns.length === 0) {
    result.warnings.push('优化目标下没有广告活动');
    if (shouldReleaseLock) releaseAccountOptimizationLock(config.accountId);
    return result;
  }
  
  // v156: 只对enabled状态的campaign执行优化
  // paused/archived的campaign在Amazon端不会投放广告，对其做出价调整是无效的
  const campaigns = allCampaigns.filter(c => (c as any).campaignStatus === 'enabled');
  const skippedCampaigns = allCampaigns.length - campaigns.length;
  if (skippedCampaigns > 0) {
    console.log(`[OptimizationTarget] v156: 跳过${skippedCampaigns}个非enabled状态的campaign (总${allCampaigns.length}个, enabled=${campaigns.length}个)`);
    result.warnings.push(`跳过${skippedCampaigns}个非enabled状态的campaign`);
  }
  if (campaigns.length === 0) {
    result.warnings.push('优化目标下没有enabled状态的广告活动');
    
    // v168: 当优化目标下所有广告活动都被暂停/归档时，自动暂停该优化目标
    // 业务规则：用户在亚马逊后台暂停广告活动 = 不参与自动优化
    if (allCampaigns.length > 0 && campaigns.length === 0) {
      const allPausedOrArchived = allCampaigns.every(c => 
        ['paused', 'archived'].includes((c as any).campaignStatus || '')
      );
      if (allPausedOrArchived) {
        try {
          await db.updatePerformanceGroup(targetId, { autoOptimize: false });
          const pauseMsg = `v168: 优化目标"${config.name}"已自动暂停 - 所有${allCampaigns.length}个广告活动均为暂停/归档状态，不再执行自动优化`;
          console.log(`[OptimizationTarget] ${pauseMsg}`);
          result.warnings.push(pauseMsg);
          result.status = 'skipped';
        } catch (autoPauseErr: any) {
          console.error(`[OptimizationTarget] v168: 自动暂停优化目标失败:`, autoPauseErr.message);
        }
      }
    }
    
    if (shouldReleaseLock) releaseAccountOptimizationLock(config.accountId);
    return result;
  }

  // v141: 统一Pre-Sync ID Resolution - 确保所有Amazon ID就绪
  // 在执行任何优化操作前，自动回填缺失的keywordId和targetId
  if (!dryRun) {
    try {
      const idResolution = await amazonIdResolver.ensureAmazonIdsReady(config.accountId);
      if (idResolution.totalMissingBefore > 0) {
        const resolvedTotal = idResolution.keywordsResolved + idResolution.keywordsCreated + idResolution.keywordsCleanedUp + idResolution.productTargetsResolved;
        console.log(`[OptimizationTarget] Pre-Sync ID Resolution: 处理了${idResolution.totalMissingBefore}个缺失ID, 解决${resolvedTotal}个, 剩余${idResolution.totalMissingAfter}个`);
        if (idResolution.totalMissingAfter > 0) {
          result.warnings.push(`Pre-Sync ID Resolution: 仍有${idResolution.totalMissingAfter}个实体缺少Amazon ID`);
        }
      }
    } catch (idErr: any) {
      console.error(`[OptimizationTarget] Pre-Sync ID Resolution异常: ${idErr.message}`);
      result.warnings.push(`Pre-Sync ID Resolution异常: ${idErr.message}`);
    }
  }
  
  const shouldExecute = (module: string) => {
    if (specificModules && specificModules.length > 0) {
      return specificModules.includes(module);
    }
    return true;
  };
  
  // 1. 执行出价优化
  if (config.enableBidOptimization && shouldExecute('bid')) {
    try {
      const bidResults = await executeBidOptimization(config, campaigns, dryRun);
      result.bidOptimization = bidResults;
    } catch (error: any) {
      result.errors.push(`出价优化失败: ${error.message}`);
    }
  }
  
  // 2. 执行位置优化
  if (config.enablePlacementOptimization && shouldExecute('placement')) {
    try {
      const placementResults = await executePlacementOptimization(config, campaigns, dryRun);
      result.placementOptimization = placementResults;
    } catch (error: any) {
      result.errors.push(`位置优化失败: ${error.message}`);
    }
  }
  
  // 2.5 执行多维度智能优化（分时+分位置+分投放词三维联动）
  // 在分时竞价执行前运行，以便基于真实数据自动生成/更新分时竞价规则
  if (config.enableDaypartingOptimization && shouldExecute('multidim')) {
    try {
      const multiDimResults = await multiDimOptimizer.executeMultiDimensionOptimization(
        targetId,
        config.accountId,
        campaigns,
        {
          targetAcos: config.targetAcos,
          targetRoas: config.targetRoas,
          maxBid: config.maxBid,
          dailyBudget: config.dailyBudget,
          optimizationGoal: config.optimizationGoal,
          lookbackDays: 30,
        },
        dryRun
      );
      result.multiDimensionOptimization = multiDimResults;
      console.log(`[OptimizationTarget] 多维度优化完成: 分析${multiDimResults.campaignsAnalyzed}个campaign, 生成${multiDimResults.rulesGenerated}条规则`);
    } catch (error: any) {
      result.errors.push(`多维度智能优化失败: ${error.message}`);
      console.error(`[OptimizationTarget] 多维度优化异常:`, error.message);
    }
  }
  
  // 3. 执行分时竞价优化（基于多维度优化生成的规则执行）
  if (config.enableDaypartingOptimization && shouldExecute('dayparting')) {
    try {
      const daypartingResults = await executeDaypartingOptimization(config, campaigns, dryRun);
      result.daypartingOptimization = daypartingResults;
    } catch (error: any) {
      result.errors.push(`分时竞价优化失败: ${error.message}`);
    }
  }
  
  // 4. 执行搜索词分析
  if (config.enableSearchTermAnalysis && shouldExecute('searchterm')) {
    try {
      const searchTermResults = await executeSearchTermAnalysis(config, campaigns, dryRun);
      result.searchTermAnalysis = searchTermResults;
    } catch (error: any) {
      result.errors.push(`搜索词分析失败: ${error.message}`);
    }
  }
  
  // 5. 执行预算分配优化
  if (config.enableBudgetAllocation && shouldExecute('budget')) {
    try {
      const budgetResults = await executeBudgetAllocation(config, campaigns, dryRun);
      result.budgetAllocation = budgetResults;
    } catch (error: any) {
      result.errors.push(`预算分配优化失败: ${error.message}`);
    }
  }
  
  // 6. 执行投放词状态变更
  if (config.enableKeywordAutoExecution && shouldExecute('keyword')) {
    try {
      const keywordResults = await executeKeywordStatusChanges(config, campaigns, dryRun);
      result.keywordStatusChanges = keywordResults;
    } catch (error: any) {
      result.errors.push(`投放词状态变更失败: ${error.message}`);
    }
  }
  
  // 7. v135: 执行广告活动状态变更
  if (config.enableKeywordAutoExecution && shouldExecute('campaign_status')) {
    try {
      const campaignResults = await executeCampaignStatusChanges(config, campaigns, dryRun);
      result.campaignStatusChanges = campaignResults;
    } catch (error: any) {
      result.errors.push(`广告活动状态变更失败: ${error.message}`);
    }
  }
  
  // 8. v135: 执行广告组状态变更
  if (config.enableKeywordAutoExecution && shouldExecute('adgroup_status')) {
    try {
      const adGroupResults = await executeAdGroupStatusChanges(config, campaigns, dryRun);
      result.adGroupStatusChanges = adGroupResults;
    } catch (error: any) {
      result.errors.push(`广告组状态变更失败: ${error.message}`);
    }
  }
  
  // 9. 执行中央竞价协调（收集各服务建议并统一处理）
  if (shouldExecute('coordination')) {
    try {
      const coordinationResults = await executeBidCoordination(
        config,
        campaigns,
        result.bidOptimization.details,
        result.placementOptimization.details,
        result.daypartingOptimization.details,
        dryRun
      );
      result.bidCoordination = coordinationResults;
      
      // 将协调器的警告添加到结果中
      if (coordinationResults.details.length > 0) {
        for (const detail of coordinationResults.details) {
          if (detail.warnings && detail.warnings.length > 0) {
            result.warnings.push(...detail.warnings);
          }
        }
      }
    } catch (error: any) {
      result.errors.push(`中央竞价协调失败: ${error.message}`);
    }
  }
  
  // 更新执行状态
  if (result.errors.length > 0) {
    result.status = result.errors.length === 7 ? 'failed' : 'partial';
  }
  
  // 记录执行日志
  if (!dryRun) {
    await recordExecutionLog(result);
    
    // v137: 将失败的同步任务入队到重试队列
    try {
      const { enqueueTasks } = await import('./optimizationSyncEngine');
      const { randomUUID } = await import('crypto');
      const failedTasks: any[] = [];
      const batchId = randomUUID();
      
      // 收集出价调整中失败的任务
      if (result.bidOptimization?.details) {
        for (const detail of result.bidOptimization.details) {
          if (detail.apiSyncStatus === 'failed') {
            failedTasks.push({
              batchId,
              optimizationTargetId: config.id,
              accountId: config.accountId,
              taskType: 'bid_adjustment',
              priority: 1,
              targetEntityType: detail.isProductTarget ? 'product_target' : 'keyword',
              targetEntityId: detail.keywordId,
              amazonEntityId: null, // 将在同步引擎中查询
              targetEntityName: detail.keywordText,
              action: detail.newBid > detail.currentBid ? 'bid_increase' : 'bid_decrease',
              oldValue: String(detail.currentBid),
              newValue: String(detail.newBid),
              changeReason: detail.reason,
              algorithmUsed: detail.algorithmUsed,
              confidenceScore: detail.confidenceScore,
              campaignId: detail.campaignId,
              campaignName: detail.campaignName,
            });
          }
        }
      }
      
      // 收集关键词状态变更中失败的任务
      if (result.keywordStatusChanges?.details) {
        for (const detail of result.keywordStatusChanges.details) {
          if (detail.apiSyncStatus === 'failed') {
            failedTasks.push({
              batchId,
              optimizationTargetId: config.id,
              accountId: config.accountId,
              taskType: 'keyword_status',
              priority: 1,
              targetEntityType: 'keyword',
              targetEntityId: detail.keywordId || detail.targetId,
              amazonEntityId: null,
              targetEntityName: detail.keywordText,
              action: detail.newStatus || detail.action,
              oldValue: detail.oldStatus || detail.previousValue,
              newValue: detail.newStatus || detail.newValue,
              changeReason: detail.reason,
              campaignId: detail.campaignId,
              campaignName: detail.campaignName,
            });
          }
        }
      }
      
      // 收集广告活动状态变更中失败的任务
      if (result.campaignStatusChanges?.details) {
        for (const detail of result.campaignStatusChanges.details) {
          if (detail.apiSyncStatus === 'failed') {
            failedTasks.push({
              batchId,
              optimizationTargetId: config.id,
              accountId: config.accountId,
              taskType: 'campaign_status',
              priority: 0,
              targetEntityType: 'campaign',
              targetEntityId: detail.campaignId,
              amazonEntityId: detail.amazonCampaignId,
              targetEntityName: detail.campaignName,
              action: detail.newStatus,
              oldValue: detail.oldStatus,
              newValue: detail.newStatus,
              changeReason: detail.reason,
            });
          }
        }
      }
      
      // 收集广告组状态变更中失败的任务
      if (result.adGroupStatusChanges?.details) {
        for (const detail of result.adGroupStatusChanges.details) {
          if (detail.apiSyncStatus === 'failed') {
            failedTasks.push({
              batchId,
              optimizationTargetId: config.id,
              accountId: config.accountId,
              taskType: 'adgroup_status',
              priority: 0,
              targetEntityType: 'adgroup',
              targetEntityId: detail.adGroupId,
              amazonEntityId: detail.amazonAdGroupId,
              targetEntityName: detail.adGroupName,
              action: detail.newStatus,
              oldValue: detail.oldStatus,
              newValue: detail.newStatus,
              changeReason: detail.reason,
            });
          }
        }
      }
      
      if (failedTasks.length > 0) {
        await enqueueTasks(failedTasks);
        console.log(`[OptimizationTarget] v137: ${failedTasks.length}个失败任务已入队重试队列, batchId=${batchId}`);
        result.retryBatchId = batchId;
        result.retryTaskCount = failedTasks.length;
      }
    } catch (enqueueErr: any) {
      console.error(`[OptimizationTarget] v137: 入队失败任务异常: ${enqueueErr.message}`);
    }
  }
  
  // v148: 释放账户优化锁
  if (shouldReleaseLock) releaseAccountOptimizationLock(config.accountId);
  
  return result;
}

/**
 * v122h: 执行出价优化 - 使用UCB增强版算法
 * 集成动态弹性系数、UCB探索-利用平衡、时间衰减ROAS、节假日调整
 */
async function executeBidOptimization(
  config: OptimizationTargetConfig,
  campaigns: any[],
  dryRun: boolean
): Promise<{ executed: boolean; adjustmentsCount: number; details: any[]; apiSyncResult?: any; apiSyncStatus?: string }> {
  const details: any[] = [];
  let adjustmentsCount = 0;
  
  // v122h: 计算广告组平均CVR、CPC、AOV作为贝叶斯先验数据
  let totalClicks = 0, totalOrders = 0, totalSpend = 0, totalSales = 0;
  for (const c of campaigns) {
    totalClicks += (c.clicks || 0);
    totalOrders += (c.orders || 0);
    totalSpend += parseFloat(c.spend || '0');
    totalSales += parseFloat(c.sales || '0');
  }
  const groupAvgCvr = totalClicks > 0 ? totalOrders / totalClicks : 0.05;
  const groupAvgCpc = totalClicks > 0 ? totalSpend / totalClicks : 0.80;
  const groupAvgAov = totalOrders > 0 ? totalSales / totalOrders : 30;
  
  const bidConfig: bidOptimizer.PerformanceGroupConfig = {
    optimizationGoal: config.optimizationGoal,
    targetAcos: config.targetAcos,
    targetRoas: config.targetRoas,
    dailyBudget: config.dailyBudget,
    maxBid: config.maxBid,
    groupAvgCvr,
    groupAvgCpc,
    groupAvgAov,
  };
  
  // v164: 从自我进化引擎获取自适应参数，注入到bidConfig中
  try {
    // 优先使用v164自我进化的自适应参数
    const evoParams = await selfEvolution.getAdaptiveOptimizationParams(config.id, config.strategyTemplateId);
    (bidConfig as any)._evolvedMaxChangePercent = evoParams.maxBidIncrease;
    (bidConfig as any)._evolvedMaxDecreasePercent = evoParams.maxBidDecrease;
    (bidConfig as any)._confidenceMultiplier = evoParams.confidenceMultiplier;
    console.log(`[BidOptimization] v164: 自适应参数已注入 - 最大提升${Math.round(evoParams.maxBidIncrease * 100)}%, 最大降低${Math.round(evoParams.maxBidDecrease * 100)}%, 成功率${Math.round(evoParams.recentSuccessRate * 100)}%`);
  } catch (e: any) {
    console.log(`[BidOptimization] v164: 自适应参数获取失败，使用默认值: ${e.message}`);
  }
  
  const currentDate = new Date();
  // v165: maxBidLimit严格使用用户配置的max_bid为绝对红线
  // CPC广告默认上限$2.00，VCPM广告默认上限$15.00
  const cpcMaxBidLimit = config.maxBid || 2.00;
  const vcpmMaxBidLimit = config.maxBid ? config.maxBid * 5 : 15.00; // VCPM出价单位是每千次展示，通常是CPC的3-10倍
  console.log(`[BidOptimization] v165: CPC最高出价=$${cpcMaxBidLimit} | VCPM最高出价=$${vcpmMaxBidLimit} (用户设置max_bid=${config.maxBid || '未设置'})`);
  console.log(`[BidOptimization] v165: 日预算=${config.dailyBudget || '未设置'}, 目标ACoS=${config.targetAcos || '未设置'}`);
  
  for (const campaign of campaigns) {
    // v163: 获取campaign级别的90天历史每日数据，用于时间衰减加权分析
    let campaignDailyData: Array<{ date: Date; spend: number; sales: number; clicks: number; orders: number }> = [];
    let campaignTimeWeightedMetrics: timeDecayService.TimeWeightedMetrics | null = null;
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 90); // v163: 从14天扩展到90天
      const rawDailyData = await db.getDailyPerformanceByDateRange(config.accountId, startDate, endDate, campaign.id);
      campaignDailyData = rawDailyData.map(d => ({
        date: new Date(d.date),
        spend: parseFloat(String(d.spend || '0')),
        sales: parseFloat(String(d.sales || '0')),
        clicks: d.clicks || 0,
        orders: d.orders || 0,
      }));
      // v163: 计算时间衰减加权指标
      const dailyDataForWeighting: timeDecayService.DailyRawData[] = rawDailyData.map(d => ({
        date: typeof d.date === 'string' ? d.date : new Date(d.date).toISOString(),
        impressions: d.impressions || 0,
        clicks: d.clicks || 0,
        spend: parseFloat(String(d.spend || '0')),
        sales: parseFloat(String(d.sales || '0')),
        orders: d.orders || 0,
      }));
      campaignTimeWeightedMetrics = timeDecayService.calculateTimeWeightedMetrics(dailyDataForWeighting);
      console.log(`[BidOptimization] v163: Campaign ${campaign.id} 时间衰减加权 - 加权ACoS=${campaignTimeWeightedMetrics.weightedAcos.toFixed(1)}%, 加权ROAS=${campaignTimeWeightedMetrics.weightedRoas.toFixed(2)}, 置信度=${campaignTimeWeightedMetrics.dataQuality.confidenceLevel}, 趋势=${campaignTimeWeightedMetrics.trendSignal.direction}`);
    } catch (e: any) {
      console.log(`[BidOptimization] 获取campaign ${campaign.id} 历史数据失败: ${e.message}`);
    }
    
    // v163: 安全检查 - 检测异常信号
    if (campaignTimeWeightedMetrics) {
      const safetyCheck = gradualEngine.performSafetyCheck(campaignTimeWeightedMetrics);
      if (safetyCheck.shouldPause) {
        console.warn(`[BidOptimization] v163: Campaign ${campaign.id} 安全检查触发暂停: ${safetyCheck.reason}`);
        details.push({
          campaignId: campaign.id,
          campaignName: campaign.campaignName,
          action: 'safety_pause',
          reason: `[安全检查] ${safetyCheck.warnings.join('；')}`,
        });
        continue; // 跳过该campaign的竞价优化
      }
      if (safetyCheck.warnings.length > 0) {
        console.log(`[BidOptimization] v163: Campaign ${campaign.id} 安全警告: ${safetyCheck.warnings.join('；')}`);
      }
    }
    
    // v165: 根据campaign的costType动态设置maxBidLimit（CPC vs VCPM）
    const isVcpmCampaign = (campaign as any).costType === 'vcpm';
    const maxBidLimit = isVcpmCampaign ? vcpmMaxBidLimit : cpcMaxBidLimit;
    if (isVcpmCampaign) {
      console.log(`[BidOptimization] v165: Campaign ${campaign.id} 识别为VCPM广告，使用VCPM最高出价$${maxBidLimit}`);
    }
    
    // v122h: 收集该campaign下所有关键词，构建EnhancedOptimizationTarget
    const keywords = await db.getKeywordsByCampaignId(campaign.id);
    const keywordTargets: bidOptimizer.EnhancedOptimizationTarget[] = [];
    
    for (const keyword of keywords) {
      if (keyword.keywordStatus !== 'enabled') continue;
      const currentBid = parseFloat(keyword.bid || '0');
      if (currentBid <= 0) continue;
      
      // v166: 关键词级别冷却期检查 - 避免重复优化
      // 如果该keyword在过去24小时内已被优化，且出价同步状态仍为pending_confirmation，则跳过
      const kwLastOptimized = (keyword as any).lastOptimizedAt ? new Date((keyword as any).lastOptimizedAt) : null;
      const kwBidSyncStatus = (keyword as any).bidSyncStatus || 'synced';
      if (kwLastOptimized && kwBidSyncStatus === 'pending_confirmation') {
        const hoursSinceOptimized = (Date.now() - kwLastOptimized.getTime()) / (1000 * 60 * 60);
        if (hoursSinceOptimized < 24) {
          console.log(`[BidOptimization] v166: 跳过关键词 ${keyword.id} "${keyword.keywordText}" - 冷却期内(${hoursSinceOptimized.toFixed(1)}h), 出价待确认 pending=$${(keyword as any).pendingBid}`);
          continue;
        }
      }
      
      keywordTargets.push({
        id: keyword.id,
        type: 'keyword',
        currentBid,
        impressions: keyword.impressions || 0,
        clicks: keyword.clicks || 0,
        spend: parseFloat(keyword.spend || '0'),
        sales: parseFloat(keyword.sales || '0'),
        orders: keyword.orders || 0,
        matchType: keyword.matchType,
        campaignStartDate: campaign.startDate ? new Date(campaign.startDate) : undefined,
        historicalAvgImpressions: campaign.impressions ? Math.round(campaign.impressions / 30) : undefined, // v163: 基于30天估算
        // v163: 传入campaign级别的90天每日数据用于时间衰减加权分析
        dailyData: campaignDailyData.length > 0 ? campaignDailyData : undefined,
        marketplace: config.marketplace,
        campaignId: campaign.id,
      });
    }
    
    // v163: 使用UCB增强版算法批量优化关键词 + 渐进式调整
    if (keywordTargets.length > 0) {
      const results = bidOptimizer.optimizePerformanceGroupEnhanced(
        keywordTargets, bidConfig, maxBidLimit, currentDate
      );
      
      for (const result of results) {
        // v163: 应用渐进式竞价调整，限制单次调整幅度
        let finalBid = result.newBid;
        if (campaignTimeWeightedMetrics && Math.abs(result.newBid - result.previousBid) > 0.01) {
          const gradualResult = gradualEngine.applyGradualBidAdjustment(
            result.previousBid,
            result.newBid,
            campaignTimeWeightedMetrics,
            0, // TODO: 追踪连续同向调整次数
            maxBidLimit,
            0.02
          );
          finalBid = gradualResult.gradualBid;
          console.log(`[BidOptimization] v163: 渐进式竞价 - 关键词${result.targetId}: 算法目标$${result.newBid.toFixed(2)} → 渐进$${finalBid.toFixed(2)} (置信度=${gradualResult.dataConfidence}, 趋势=${gradualResult.trendDirection})`);
        }
        
        // v165: 绝对红线校验（最后一道防线）——无论任何算法计算结果，finalBid不得超过maxBidLimit
        finalBid = Math.min(finalBid, maxBidLimit);
        finalBid = Math.max(finalBid, 0.02);
        finalBid = Math.round(finalBid * 100) / 100;
        if (finalBid > maxBidLimit) {
          console.error(`[BidOptimization] v165: 红线拦截! keyword ${result.targetId} finalBid=$${finalBid} > maxBidLimit=$${maxBidLimit}`);
          finalBid = maxBidLimit;
        }
        
        if (Math.abs(finalBid - result.previousBid) > 0.01) {
          const keyword = keywords.find(k => k.id === result.targetId);
          const adjustment = {
            keywordId: result.targetId,
            keywordText: keyword?.keywordText || `关键词 ${result.targetId}`,
            campaignId: campaign.id,
            campaignName: campaign.campaignName,
            currentBid: result.previousBid,
            newBid: finalBid, // v165: 经过绝对红线校验的最终出价
            changePercent: ((finalBid - result.previousBid) / result.previousBid * 100).toFixed(2),
            reason: `[v165渐进+${result.algorithmUsed}] ${result.reason}`,
            algorithmUsed: result.algorithmUsed,
            confidenceScore: result.confidenceScore,
          };
          
          details.push(adjustment);
          
          if (!dryRun) {
            adjustmentsCount++;
          }
        }
      }
    }
    
    // v122h: 商品定向也使用UCB增强版算法
    const adGroupsList = await db.getAdGroupsByCampaignId(campaign.id);
    const productTargets: bidOptimizer.EnhancedOptimizationTarget[] = [];
    const allTargets: any[] = [];
    
    for (const ag of adGroupsList) {
      const targets = await db.getProductTargetsByAdGroupId(ag.id);
      for (const target of targets) {
        if (target.targetStatus !== 'enabled') continue;
        const currentBid = parseFloat(target.bid || '0');
        if (currentBid <= 0) continue;
        
        allTargets.push(target);
        productTargets.push({
          id: target.id,
          type: 'product_target',
          currentBid,
          impressions: target.impressions || 0,
          clicks: target.clicks || 0,
          spend: parseFloat(target.spend || '0'),
          sales: parseFloat(target.sales || '0'),
          orders: target.orders || 0,
          matchType: target.targetMatchType || 'exact',
          campaignStartDate: campaign.startDate ? new Date(campaign.startDate) : undefined,
          historicalAvgImpressions: campaign.impressions ? Math.round(campaign.impressions / 30) : undefined, // v163
          dailyData: campaignDailyData.length > 0 ? campaignDailyData : undefined,
          marketplace: config.marketplace,
          campaignId: campaign.id,
        });
      }
    }
    
    // v163: 商品定向也使用渐进式竞价调整
    if (productTargets.length > 0) {
      const results = bidOptimizer.optimizePerformanceGroupEnhanced(
        productTargets, bidConfig, maxBidLimit, currentDate
      );
      
      for (const result of results) {
        let finalBid = result.newBid;
        if (campaignTimeWeightedMetrics && Math.abs(result.newBid - result.previousBid) > 0.01) {
          const gradualResult = gradualEngine.applyGradualBidAdjustment(
            result.previousBid,
            result.newBid,
            campaignTimeWeightedMetrics,
            0,
            maxBidLimit,
            0.02
          );
          finalBid = gradualResult.gradualBid;
          console.log(`[BidOptimization] v163: 渐进式商品定向 - ${result.targetId}: $${result.newBid.toFixed(2)} → $${finalBid.toFixed(2)}`);
        }
        
        // v165: 商品定向绝对红线校验（最后一道防线）
        finalBid = Math.min(finalBid, maxBidLimit);
        finalBid = Math.max(finalBid, 0.02);
        finalBid = Math.round(finalBid * 100) / 100;
        if (finalBid > maxBidLimit) {
          console.error(`[BidOptimization] v165: 红线拦截! product_target ${result.targetId} finalBid=$${finalBid} > maxBidLimit=$${maxBidLimit}`);
          finalBid = maxBidLimit;
        }
        
        if (Math.abs(finalBid - result.previousBid) > 0.01) {
          const target = allTargets.find(t => t.id === result.targetId);
          const adjustment = {
            keywordId: result.targetId,
            keywordText: target?.targetText || target?.targetValue || `商品定向 ${result.targetId}`,
            campaignId: campaign.id,
            campaignName: campaign.campaignName,
            currentBid: result.previousBid,
            newBid: finalBid, // v165: 经过绝对红线校验的最终出价
            changePercent: ((finalBid - result.previousBid) / result.previousBid * 100).toFixed(2),
            reason: `商品定向 - [v165渐进+${result.algorithmUsed}] ${result.reason}`,
            isProductTarget: true,
            algorithmUsed: result.algorithmUsed,
            confidenceScore: result.confidenceScore,
          };
          
          details.push(adjustment);
          
          if (!dryRun) {
            adjustmentsCount++;
          }
        }
      }
    }
  }
  
  // v148+v123: 先批量同步出价调整到 Amazon API，确认成功后再更新本地DB
  let apiSyncResult: { success: number; failed: number; errors: string[]; itemResults?: Map<number, { status: 'synced' | 'failed'; error?: string }> } = { success: 0, failed: 0, errors: [] };
  let apiSyncStatus: 'pending' | 'synced' | 'failed' | 'partial' = 'pending';
  
  if (!dryRun && details.length > 0) {
    try {
      const accountId = config.accountId;
      
      // v141: 补偿同步已移至统一的Pre-Sync ID Resolution层 (amazonIdResolver.ts)
      // 在executeOptimizationTarget入口处统一执行，所有优化模块共享
      // 旧的v130/v138补偿同步代码已在v141中删除
      
      apiSyncResult = await amazonApiHelper.syncBidAdjustmentsToAmazon(
        accountId,
        details.map(d => ({
          keywordId: d.keywordId,
          newBid: d.newBid,
          campaignId: d.campaignId,
          reason: d.reason,
          isProductTarget: d.isProductTarget || false,
        }))
      );
      
      if (apiSyncResult.failed === 0 && apiSyncResult.success > 0) {
        apiSyncStatus = 'synced';
      } else if (apiSyncResult.success === 0) {
        apiSyncStatus = 'failed';
      } else {
        apiSyncStatus = 'partial';
      }
      
      console.log(`[BidOptimization] Amazon API同步: 成功=${apiSyncResult.success}, 失败=${apiSyncResult.failed}, 状态=${apiSyncStatus}`);
      if (apiSyncResult.errors.length > 0) {
        console.error(`[BidOptimization] Amazon API同步错误:`, apiSyncResult.errors.join('; '));
      }
      
      // v148: API调用成功后，才更新本地数据库（先API后DB原则）
      // v148: 使用事务保护批量DB更新，确保原子性
      const syncedDetails = details.filter(d => {
        const itemResult = apiSyncResult.itemResults?.get(d.keywordId);
        return itemResult?.status === 'synced';
      });
      const skippedDetails = details.filter(d => {
        const itemResult = apiSyncResult.itemResults?.get(d.keywordId);
        return itemResult?.status !== 'synced';
      });
      
      if (syncedDetails.length > 0) {
        const dbConn = await getDb();
        if (dbConn) {
          try {
            await dbConn.transaction(async (tx) => {
              for (const detail of syncedDetails) {
                if (detail.isProductTarget) {
                  await tx.update(productTargetsTable)
                    .set({ bid: detail.newBid.toFixed(2) })
                    .where(eq(productTargetsTable.id, detail.keywordId));
                } else {
                  // v166: 更新bid的同时，标记pending状态和优化时间
                  await tx.update(keywordsTable)
                    .set({
                      bid: detail.newBid.toFixed(2),
                      lastOptimizedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
                      pendingBid: detail.newBid.toFixed(2),
                      bidSyncStatus: 'pending_confirmation',
                    } as any)
                    .where(eq(keywordsTable.id, detail.keywordId));
                }
              }
            });
            console.log(`[BidOptimization] v148: 事务批量DB更新成功: ${syncedDetails.length}条`);
          } catch (txErr: any) {
            console.error(`[BidOptimization] v148: 事务DB更新失败(已回滚): ${txErr.message}`);
            // 事务失败时，所有DB更新自动回滚，保持数据一致性
          }
        }
      }
      
      for (const detail of skippedDetails) {
        console.warn(`[BidOptimization] v148: API同步失败，跳过DB更新: targetId=${detail.keywordId}`);
      }
      
      // v166: 注册优化后验证任务 - 延迟45秒后从 Amazon 回查确认
      if (syncedDetails.length > 0) {
        try {
          postOptVerifier.scheduleBidVerification(
            config.accountId,
            syncedDetails.map(d => ({
              localKeywordId: d.keywordId,
              amazonKeywordId: d.amazonKeywordId || String(d.keywordId),
              expectedBid: d.newBid,
              campaignId: d.campaignId,
              adGroupId: d.adGroupId,
              isProductTarget: d.isProductTarget || false,
            }))
          );
          console.log(`[BidOptimization] v166: 已注册${syncedDetails.length}个出价验证任务`);
        } catch (verifyErr: any) {
          console.warn(`[BidOptimization] v166: 注册验证任务失败(不影响主流程): ${verifyErr.message}`);
        }
      }
    } catch (apiError: any) {
      apiSyncStatus = 'failed';
      apiSyncResult.errors.push(apiError.message);
      console.error(`[BidOptimization] Amazon API同步异常:`, apiError.message);
      // v148: API整体异常，不更新任何本地DB记录
      console.error(`[BidOptimization] v148: API整体异常，所有本地DB更新已跳过`);
    }
  } else if (dryRun) {
    apiSyncStatus = 'pending'; // 模拟模式不同步
  }
  
  // v140: 将每条调整的独立同步状态附加到详情中（而非批量状态）
  for (const detail of details) {
    const itemResult = apiSyncResult.itemResults?.get(detail.keywordId);
    if (itemResult) {
      // 使用该条目自身的同步状态
      detail.apiSyncStatus = itemResult.status; // 'synced' | 'failed'
      detail.apiSyncDetail = JSON.stringify({
        status: itemResult.status,
        error: itemResult.error || null,
      });
    } else if (dryRun) {
      detail.apiSyncStatus = 'pending';
      detail.apiSyncDetail = JSON.stringify({ status: 'pending', error: null });
    } else {
      // 未在itemResults中找到（理论上不应发生），使用批量状态作为降级
      detail.apiSyncStatus = apiSyncStatus;
      detail.apiSyncDetail = JSON.stringify({
        status: apiSyncStatus,
        error: '未获取到单条同步状态',
      });
    }
  }
  
  return { executed: true, adjustmentsCount: dryRun ? details.length : adjustmentsCount, details, apiSyncResult, apiSyncStatus };
}

/**
 * 执行位置优化
 */
async function executePlacementOptimization(
  config: OptimizationTargetConfig,
  campaigns: any[],
  dryRun: boolean
): Promise<{ executed: boolean; adjustmentsCount: number; details: any[] }> {
  const details: any[] = [];
  let adjustmentsCount = 0;
  
  for (const campaign of campaigns) {
    try {
      // 分析位置表现
      // v158修复: 使用campaign.campaignId而不是amazonCampaignId
      const analysis = await placementOptimizationService.analyzePlacementPerformance(campaign.campaignId || campaign.id.toString(), config.accountId);
      
      // 生成位置调整建议
      const suggestions = await placementOptimizationService.generatePlacementSuggestions(
        campaign.campaignId || campaign.id.toString(),
        config.accountId
      );
      
      for (const suggestion of suggestions) {
        const adjustment: any = {
          accountId: config.accountId,
          campaignId: campaign.id,
          campaignName: campaign.campaignName,
          placement: suggestion.placement,
          currentMultiplier: suggestion.currentMultiplier,
          suggestedMultiplier: suggestion.suggestedMultiplier,
          reason: suggestion.reason,
          apiSyncStatus: dryRun ? 'pending' : 'pending',
        };
        
        details.push(adjustment);
        
        if (!dryRun && suggestion.suggestedMultiplier !== suggestion.currentMultiplier) {
          // 实际执行位置调整（本地数据库）
          await placementOptimizationService.applyPlacementAdjustment(
            campaign.campaignId || campaign.id.toString(),
            config.accountId,
            suggestion
          );
          adjustmentsCount++;
        }
      }
      
      // v134: 同步位置倾斜到 Amazon API，并记录同步状态
      if (!dryRun && suggestions.length > 0) {
        let placementSyncSuccess = false;
        let placementSyncError = '';
        try {
          const amazonCampaignId = campaign.campaignId || campaign.id.toString();
          const topSuggestion = suggestions.find((s: any) => s.placement === 'top_of_search');
          const productSuggestion = suggestions.find((s: any) => s.placement === 'product_page');
          
          if (topSuggestion || productSuggestion) {
            const syncResult = await amazonApiHelper.syncPlacementAdjustmentToAmazon(
              config.accountId,
              amazonCampaignId,
              topSuggestion?.suggestedMultiplier || campaign.placementTopSearchBidAdjustment || 0,
              productSuggestion?.suggestedMultiplier || campaign.placementProductPageBidAdjustment || 0,
              `位置优化: Top=${topSuggestion?.suggestedMultiplier || 0}%, Product=${productSuggestion?.suggestedMultiplier || 0}%`
            );
            placementSyncSuccess = syncResult;
          }
        } catch (apiError: any) {
          placementSyncError = apiError.message;
          console.error(`[PlacementOptimization] Amazon API同步失败 (Campaign ${campaign.campaignName}):`, apiError.message);
        }
        
        // v134: 将同步状态回写到该campaign的所有detail中
        for (const d of details.filter(d => d.campaignId === campaign.id)) {
          d.apiSyncStatus = placementSyncSuccess ? 'synced' : (placementSyncError ? 'failed' : 'pending');
          d.apiSyncDetail = placementSyncError ? JSON.stringify({ error: placementSyncError }) : null;
        }
        
        // v166: 注册位置倾斜验证任务
        if (placementSyncSuccess) {
          try {
            const amazonCampaignId = campaign.campaignId || campaign.id.toString();
            const topSuggestion = suggestions?.find((s: any) => s.placement === 'top_of_search');
            const productSuggestion = suggestions?.find((s: any) => s.placement === 'product_page');
            postOptVerifier.schedulePlacementVerification(
              config.accountId,
              [{
                localCampaignId: campaign.id,
                amazonCampaignId: amazonCampaignId,
                expectedTopOfSearch: topSuggestion?.suggestedMultiplier,
                expectedProductPage: productSuggestion?.suggestedMultiplier,
              }]
            );
          } catch (verifyErr: any) {
            console.warn(`[PlacementOptimization] v166: 注册验证任务失败(不影响主流程): ${verifyErr.message}`);
          }
        }
      }
    } catch (error: any) {
      details.push({
        campaignId: campaign.id,
        campaignName: campaign.campaignName,
        error: error.message,
      });
    }
  }
  
  return { executed: true, adjustmentsCount: dryRun ? details.length : adjustmentsCount, details };
}

/**
 * 执行分时竞价优化
 */
async function executeDaypartingOptimization(
  config: OptimizationTargetConfig,
  campaigns: any[],
  dryRun: boolean
): Promise<{ executed: boolean; adjustmentsCount: number; details: any[] }> {
  const details: any[] = [];
  let adjustmentsCount = 0;
  
  // v122h: 使用站点本地时间而非UTC时间
  const marketplace = config.marketplace || 'US';
  const now = new Date();
  const currentHour = getLocalHour(now, marketplace);
  const currentDayOfWeek = getLocalDayOfWeek(now, marketplace);
  
  for (const campaign of campaigns) {
    try {
      // v157: 修复分时策略查找 - 按campaignId查找，并自动创建缺失的策略
      let strategy = await daypartingService.getDaypartingStrategyByCampaignId(campaign.id);
      if (!strategy) {
        // 自动创建分时策略
        strategy = await daypartingService.ensureDaypartingStrategy(
          config.accountId,
          campaign.id,
          campaign.campaignName,
          {
            optimizationGoal: config.optimizationGoal,
            targetAcos: config.targetAcos,
            targetRoas: config.targetRoas,
          }
        );
      }
      if (!strategy || strategy.daypartingStatus !== 'active') continue;
      
      // 获取当前时段的调整规则
      // v157: 修复参数顺序 - getHourlyRule(strategyId, dayOfWeek, hour)
      const hourlyRule = await daypartingService.getHourlyRule(strategy.id, currentDayOfWeek, currentHour);
      if (!hourlyRule) continue;
      
      const bidMultiplier = parseFloat(hourlyRule.bidMultiplier || '1.00');
      
      // 获取广告活动下的所有关键词
      const keywords = await db.getKeywordsByCampaignId(campaign.id);
      
      for (const keyword of keywords) {
        if (keyword.keywordStatus !== 'enabled') continue;
        
        const baseBid = parseFloat(keyword.bid || '0');
        if (baseBid <= 0) continue;
        
        const adjustedBid = baseBid * bidMultiplier;
        
        const adjustment: any = {
          accountId: config.accountId,
          campaignId: campaign.id,
          campaignName: campaign.campaignName,
          keywordId: keyword.id,
          keywordText: keyword.keywordText,
          hour: currentHour,
          dayOfWeek: currentDayOfWeek,
          baseBid,
          bidMultiplier,
          adjustedBid,
          currentBid: baseBid,
          newBid: adjustedBid,
          reason: `分时竞价: ${currentHour}:00 乘数${bidMultiplier}x, 基础出价$${baseBid.toFixed(2)} → $${adjustedBid.toFixed(2)}`,
          apiSyncStatus: dryRun ? 'pending' : 'pending',
        };
        
        details.push(adjustment);
        
        if (!dryRun && bidMultiplier !== 1.0) {
          // v134: 实际通过 Amazon API 调整出价，并记录同步状态
          try {
            const syncResult = await amazonApiHelper.syncBidAdjustmentsToAmazon(
              config.accountId,
              [{
                keywordId: keyword.id,
                newBid: Math.round(adjustedBid * 100) / 100,
                campaignId: campaign.id,
                reason: `分时竞价: ${currentHour}:00 乘数${bidMultiplier}`,
                isProductTarget: false,
              }]
            );
            if (syncResult.success > 0) {
              adjustmentsCount++;
              adjustment.apiSyncStatus = 'synced';
            } else {
              adjustment.apiSyncStatus = 'failed';
              adjustment.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
            }
          } catch (apiError: any) {
            adjustment.apiSyncStatus = 'failed';
            adjustment.apiSyncDetail = JSON.stringify({ error: apiError.message });
            console.error(`[DaypartingOptimization] API同步失败 (kw ${keyword.keywordText}):`, apiError.message);
          }
        }
      }
    } catch (error: any) {
      details.push({
        campaignId: campaign.id,
        campaignName: campaign.campaignName,
        error: error.message,
      });
    }
  }
  
  return { executed: true, adjustmentsCount, details };
}

/**
 * 执行搜索词分析
 */
async function executeSearchTermAnalysis(
  config: OptimizationTargetConfig,
  campaigns: any[],
  dryRun: boolean
): Promise<{ executed: boolean; negativeKeywordsAdded: number; newKeywordsAdded: number; details: any[] }> {
  const details: any[] = [];
  let negativeKeywordsAdded = 0;
  let newKeywordsAdded = 0;
  
  for (const campaign of campaigns) {
    try {
      // 获取搜索词数据
      const searchTerms = await db.getSearchTermsByCampaignId(campaign.id);
      
      // 分类搜索词 - 使用简化的分类逻辑
      const searchTermTexts = searchTerms.map(st => st.searchTerm);
      const classification = adAutomation.classifySearchTerms(
        searchTermTexts,
        [], // 产品关键词
        { category: '', brand: '' } // 产品属性
      );
      
      // v122h: 获取品牌词用于保护
      const account = await db.getAdAccountById(config.accountId);
      const brandTerms = account?.storeName ? [account.storeName] : [];
      
      // 处理分类结果
      for (const term of classification) {
        if (term.suggestedAction === 'negative_exact' || term.suggestedAction === 'negative_phrase') {
          // v122h: 品牌词保护 - 不否定含有品牌词的搜索词
          if (brandTerms.length > 0 && isProtectedKeyword(term.searchTerm, brandTerms)) {
            details.push({
              campaignId: campaign.id,
              campaignName: campaign.campaignName,
              searchTerm: term.searchTerm,
              action: 'brand_protect_skip',
              reason: `[品牌词保护] 搜索词"${term.searchTerm}"含有品牌词，跳过否定`,
            });
            continue;
          }
          
          // v122h: 探索期保护 - 检查对应的投放词是否在探索期内
          const matchingKeywords = await db.getKeywordsByCampaignId(campaign.id);
          const matchingKw = matchingKeywords.find((kw: any) => 
            kw.keywordText?.toLowerCase() === term.searchTerm.toLowerCase()
          );
          if (matchingKw?.createdAt) {
            const kwCreatedAt = new Date(matchingKw.createdAt);
            if (isNewKeyword(kwCreatedAt, matchingKw.clicks || 0, matchingKw.impressions || 0, 7)) {
              details.push({
                campaignId: campaign.id,
                campaignName: campaign.campaignName,
                searchTerm: term.searchTerm,
                action: 'exploration_protect_skip',
                reason: `[探索期保护] 对应投放词在探索期内，跳过否定，给予充分的数据积累时间`,
              });
              continue;
            }
          }
          
          const negativeKeyword: any = {
            accountId: config.accountId,
            campaignId: campaign.id,
            campaignName: campaign.campaignName,
            searchTerm: term.searchTerm,
            matchType: term.suggestedAction === 'negative_exact' ? 'negative_exact' : 'negative_phrase',
            action: 'add_negative',
            reason: `负面搜索词: ${term.reason}`,
            apiSyncStatus: dryRun ? 'pending' : 'pending',
          };
          
          details.push(negativeKeyword);
          
          if (!dryRun) {
            const matchType = term.suggestedAction === 'negative_exact' ? 'exact' : 'phrase';
            // v165: 否词操作改为先记录到details，等待后续统一调用Amazon API
            // API成功后再写入本地DB（见下方v134否定词同步代码块）
            negativeKeyword._pendingDbInsert = {
              accountId: campaign.accountId || 0,
              campaignId: campaign.id,
              negativeLevel: 'campaign',
              negativeType: 'keyword',
              negativeText: term.searchTerm,
              negativeMatchType: matchType === 'exact' ? 'negative_exact' : 'negative_phrase',
              negativeSource: 'ngram_analysis',
              createdAt: new Date().toISOString(),
            };
            negativeKeywordsAdded++;
          }
        } else if (term.suggestedAction === 'target') {
          const newKeyword: any = {
            accountId: config.accountId,
            campaignId: campaign.id,
            campaignName: campaign.campaignName,
            searchTerm: term.searchTerm,
            matchType: (term.matchTypeSuggestion || 'exact'),
            action: 'add_keyword',
            reason: `正面搜索词: ${term.reason}`,
            apiSyncStatus: dryRun ? 'pending' : 'pending',
          };
          
          details.push(newKeyword);
          
          if (!dryRun) {
            // v133: 添加为新关键词 - 先检查去重，再调用Amazon API创建
            const dbInstance = await db.getDb();
            if (dbInstance) {
              // 获取广告组（需要Amazon adGroupId和campaignId）
              const adGroups = await db.getAdGroupsByCampaignId(campaign.id);
              if (adGroups.length > 0) {
                const adGroup = adGroups[0];
                const amazonAdGroupId = Number(adGroup.adGroupId || 0);
                const amazonCampaignId = Number(campaign.campaignId || campaign.id);
                const matchType = (term.matchTypeSuggestion || 'exact') as 'exact' | 'phrase' | 'broad';
                const bid = 0.50;
                
                // v168: 增强去重检查 - 检查本地数据库是否已存在相同关键词
                // 业务规则：Amazon不允许在同一广告组中创建同名关键词（即使匹配类型不同）
                // 因此去重时不仅检查完全匹配，还要检查同名不同匹配类型的关键词
                const { keywords } = await import('../drizzle/schema');
                const { eq: eqOp, and: andOp } = await import('drizzle-orm');
                // 检查同一adGroup中是否已存在同名关键词（任意匹配类型）
                const existingKeywords = await dbInstance.select({ id: keywords.id, keywordId: keywords.keywordId, matchType: keywords.matchType })
                  .from(keywords)
                  .where(andOp(
                    eqOp(keywords.adGroupId, adGroup.id),
                    eqOp(keywords.keywordText, term.searchTerm)
                  ))
                  .limit(10);
                
                if (existingKeywords.length > 0) {
                  // v139: 如果存在多条重复记录（keywordId为NULL），清理多余的
                  if (existingKeywords.length > 1) {
                    const withId = existingKeywords.filter(k => k.keywordId !== null);
                    const withoutId = existingKeywords.filter(k => k.keywordId === null);
                    // 保留有keywordId的记录，删除多余的无ID记录
                    const toDelete = withId.length > 0 ? withoutId : withoutId.slice(1);
                    for (const dup of toDelete) {
                      try {
                        await dbInstance.delete(keywords).where(eqOp(keywords.id, dup.id));
                        console.log(`[SearchTermAnalysis] 🧹 清理重复关键词: id=${dup.id} "${term.searchTerm}" (keywordId=${dup.keywordId})`);
                      } catch (delErr: any) {
                        console.warn(`[SearchTermAnalysis] 清理重复关键词失败: id=${dup.id}: ${delErr.message}`);
                      }
                    }
                  }
                  const existingMatchTypes = existingKeywords.map(k => k.matchType || 'unknown').join(',');
                  console.log(`[SearchTermAnalysis] ⏭️ v168: 关键词已存在，跳过创建: "${term.searchTerm}" (请求=${matchType}, 已存在=${existingMatchTypes}) id=${existingKeywords[0].id}, keywordId=${existingKeywords[0].keywordId}`);
                } else {
                  // 插入本地数据库 - v138: 修复缺少accountId和campaignId的问题
                  const insertResult = await dbInstance.insert(keywords).values({
                    adGroupId: adGroup.id,
                    keywordText: term.searchTerm,
                    matchType: matchType as any,
                    bid: String(bid),
                    keywordStatus: 'enabled',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  });
                  const localKeywordId = (insertResult as any)[0]?.insertId;
                  
                  // 调用Amazon API创建关键词
                  if (amazonAdGroupId > 0 && amazonCampaignId > 0) {
                    try {
                      const apiResult = await amazonApiHelper.syncNewKeywordsToAmazon(
                        config.accountId,
                        [{
                          localKeywordId: localKeywordId || undefined,
                          adGroupId: amazonAdGroupId,
                          campaignId: amazonCampaignId,
                          keywordText: term.searchTerm,
                          matchType: matchType,
                          bid: bid,
                        }]
                      );
                      if (apiResult.success > 0) {
                        newKeyword.apiSyncStatus = 'synced';
                        console.log(`[SearchTermAnalysis] ✅ 新关键词已同步到Amazon: "${term.searchTerm}"`);
                      } else {
                        newKeyword.apiSyncStatus = 'failed';
                        newKeyword.apiSyncDetail = JSON.stringify({ errors: apiResult.errors });
                        console.error(`[SearchTermAnalysis] ❌ 新关键词同步失败: "${term.searchTerm}" - ${apiResult.errors.join('; ')}`);
                      }
                    } catch (apiError: any) {
                      newKeyword.apiSyncStatus = 'failed';
                      newKeyword.apiSyncDetail = JSON.stringify({ error: apiError.message });
                      console.error(`[SearchTermAnalysis] ❌ 新关键词API同步异常: "${term.searchTerm}" -`, apiError.message);
                    }
                  } else {
                    console.warn(`[SearchTermAnalysis] ⚠️ 缺少Amazon ID，无法同步关键词: adGroupId=${amazonAdGroupId}, campaignId=${amazonCampaignId}`);
                  }
                }
              }
            }
            newKeywordsAdded++;
          }
        }
      }
      // v134: 同步否定关键词到 Amazon API，并记录同步状态
      if (!dryRun) {
        const negativeDetails = details.filter(d => d.action === 'add_negative' && d.campaignId === campaign.id);
        if (negativeDetails.length > 0) {
          try {
            const amazonCampaignId = Number(campaign.campaignId || campaign.id);
            const negSyncResult = await amazonApiHelper.syncNegativeKeywordsToAmazon(
              config.accountId,
              negativeDetails.map(d => ({
                campaignId: amazonCampaignId,
                keywordText: d.searchTerm,
                matchType: d.matchType === 'negative_exact' ? 'negativeExact' as const : 'negativePhrase' as const,
                level: 'campaign' as const,
              }))
            );
            // v134: 将同步状态回写到detail中
            const negSyncStatus = negSyncResult.failed === 0 && negSyncResult.success > 0 ? 'synced' : 
                                  negSyncResult.success === 0 ? 'failed' : 'partial';
            for (const d of negativeDetails) {
              d.apiSyncStatus = negSyncStatus;
              if (negSyncResult.errors.length > 0) {
                d.apiSyncDetail = JSON.stringify({ errors: negSyncResult.errors });
              }
            }
            console.log(`[SearchTermAnalysis] Amazon API同步: ${negativeDetails.length}个否定词, 状态=${negSyncStatus} (Campaign ${campaign.campaignName})`);
            
            // v165: API成功后才写入本地DB（先API后DB原则）
            if (negSyncStatus === 'synced' || negSyncStatus === 'partial') {
              const dbInstance = await db.getDb();
              if (dbInstance) {
                const { negativeKeywords } = await import('../drizzle/schema');
                for (const d of negativeDetails) {
                  if (d._pendingDbInsert && d.apiSyncStatus !== 'failed') {
                    try {
                      await dbInstance.insert(negativeKeywords).values(d._pendingDbInsert);
                      console.log(`[SearchTermAnalysis] v165: 否词DB写入成功: "${d.searchTerm}"`);
                    } catch (dbErr: any) {
                      console.error(`[SearchTermAnalysis] v165: 否词DB写入失败: "${d.searchTerm}" - ${dbErr.message}`);
                    }
                  }
                }
              }
              
              // v166: 注册否词验证任务
              try {
                const successNegDetails = negativeDetails.filter(d => d.apiSyncStatus !== 'failed');
                if (successNegDetails.length > 0) {
                  postOptVerifier.scheduleNegativeKeywordVerification(
                    config.accountId,
                    successNegDetails.map(d => ({
                      localId: d._pendingDbInsert?.id || 0,
                      keywordText: d.searchTerm,
                      matchType: d.matchType === 'negative_exact' ? 'negativeExact' : 'negativePhrase',
                      campaignId: campaign.id,
                    }))
                  );
                }
              } catch (verifyErr: any) {
                console.warn(`[SearchTermAnalysis] v166: 注册验证任务失败(不影响主流程): ${verifyErr.message}`);
              }
            } else {
              console.warn(`[SearchTermAnalysis] v165: API同步失败，跳过本地DB写入 (Campaign ${campaign.campaignName})`);
            }
          } catch (apiError: any) {
            for (const d of negativeDetails) {
              d.apiSyncStatus = 'failed';
              d.apiSyncDetail = JSON.stringify({ error: apiError.message });
            }
            console.error(`[SearchTermAnalysis] Amazon API同步失败，未写入本地DB (Campaign ${campaign.campaignName}):`, apiError.message);
          }
        }
      }
    } catch (error: any) {
      details.push({
        campaignId: campaign.id,
        campaignName: campaign.campaignName,
        error: error.message,
      });
    }
  }
  
  return { executed: true, negativeKeywordsAdded, newKeywordsAdded, details };
}

/**
 * 执行预算分配优化
 */
async function executeBudgetAllocation(
  config: OptimizationTargetConfig,
  campaigns: any[],
  dryRun: boolean
): Promise<{ executed: boolean; adjustmentsCount: number; details: any[] }> {
  const details: any[] = [];
  let adjustmentsCount = 0;
  
  try {
    // 获取预算分配建议
    const budgetResult = await intelligentBudgetAllocationService.generateBudgetAllocationSuggestions(config.id);
    
    for (const suggestion of budgetResult.suggestions) {
      const campaign = campaigns.find(c => c.id === suggestion.campaignId);
      if (!campaign) continue;
      
      // v163: 应用渐进式预算调整
      let finalBudget = suggestion.suggestedBudget;
      const campaignPerf = budgetResult.suggestions.find(s => s.campaignId === suggestion.campaignId);
      const twMetrics = (campaignPerf as any)?.timeWeightedMetrics;
      
      if (twMetrics && Math.abs(suggestion.suggestedBudget - suggestion.currentBudget) > 0.50) {
        const gradualResult = gradualEngine.applyGradualBudgetAdjustment(
          suggestion.currentBudget,
          twMetrics.weightedDailySpend || suggestion.currentBudget,
          suggestion.suggestedBudget,
          twMetrics
        );
        finalBudget = gradualResult.gradualBudget;
        console.log(`[BudgetAllocation] v163: 渐进式预算 - Campaign ${campaign.campaignName}: $${suggestion.currentBudget.toFixed(0)}→$${finalBudget.toFixed(0)} (算法目标$${suggestion.suggestedBudget.toFixed(0)}, 订单保护=${gradualResult.orderProtectionActive})`);
      }
      
      const adjustment: any = {
        accountId: config.accountId,
        campaignId: suggestion.campaignId,
        campaignName: campaign.campaignName,
        currentBudget: suggestion.currentBudget,
        suggestedBudget: finalBudget, // v163: 使用渐进式调整后的预算
        changeAmount: finalBudget - suggestion.currentBudget,
        changePercent: ((finalBudget - suggestion.currentBudget) / suggestion.currentBudget * 100).toFixed(2),
        reason: `[v163渐进] ${suggestion.reasons?.join(', ') || ''}`,
        expectedImpact: (suggestion as any).expectedRoasChange || 0,
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
          const amazonCampaignId = campaign.campaignId || campaign.id.toString();
          const budgetSyncResult = await amazonApiHelper.syncBudgetAdjustmentToAmazon(
            config.accountId,
            amazonCampaignId,
            finalBudget, // v163: 使用渐进式调整后的预算
            `v163渐进式预算优化: $${suggestion.currentBudget.toFixed(2)} -> $${finalBudget.toFixed(2)}`
          );
          
          if (budgetSyncResult) {
            // API成功后才更新本地DB
            // v166: 同时标记pending状态，等待下次同步确认
            await db.updateCampaign(suggestion.campaignId, { 
              dailyBudget: finalBudget.toFixed(2),
              lastOptimizedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
              pendingBudget: finalBudget.toFixed(2),
              budgetSyncStatus: 'pending_confirmation',
            } as any);
            adjustmentsCount++;
            adjustment.apiSyncStatus = 'synced';
            
            // v166: 注册预算验证任务
            try {
              postOptVerifier.scheduleBudgetVerification(
                config.accountId,
                [{
                  localCampaignId: suggestion.campaignId,
                  amazonCampaignId: amazonCampaignId,
                  expectedBudget: finalBudget,
                }]
              );
            } catch (verifyErr: any) {
              console.warn(`[BudgetAllocation] v166: 注册验证任务失败(不影响主流程): ${verifyErr.message}`);
            }
          } else {
            // API返回false，不更新本地DB
            adjustment.apiSyncStatus = 'failed';
            console.warn(`[BudgetAllocation] v148: API同步失败，跳过DB更新 (Campaign ${campaign.campaignName})`);
          }
        } catch (apiError: any) {
          // API异常，不更新本地DB，保持数据一致性
          adjustment.apiSyncStatus = 'failed';
          adjustment.apiSyncDetail = JSON.stringify({ error: apiError.message });
          console.error(`[BudgetAllocation] v148: API同步失败，跳过DB更新 (Campaign ${campaign.campaignName}):`, apiError.message);
        }
      }
    }
  } catch (error: any) {
    details.push({ error: error.message });
  }
  
  return { executed: true, adjustmentsCount: dryRun ? details.length : adjustmentsCount, details };
}

/**
 * 执行投放词状态变更
 */
async function executeKeywordStatusChanges(
  config: OptimizationTargetConfig,
  campaigns: any[],
  dryRun: boolean
): Promise<{ executed: boolean; pausedCount: number; enabledCount: number; details: any[] }> {
  const details: any[] = [];
  let pausedCount = 0;
  let enabledCount = 0;
  
  // v122g: 策略感知的动态暂停阈值
  // 不同策略对“高花费无转化”的容忍度不同
  const goal = config.optimizationGoal || 'balanced';
  let pauseSpendThreshold = 50;  // 默认花费阈值
  let pauseClickThreshold = 20;  // 默认点击阈值
  let maxAcosThreshold = (config.targetAcos || 30) * 2.5; // 默认ACoS上限为目标的2.5倍
  
  if (['aggressive-growth', 'seasonal-boost', 'market-expansion'].includes(goal)) {
    // 激进策略：更高的容忍度，允许更多试错成本
    pauseSpendThreshold = 100;
    pauseClickThreshold = 40;
    maxAcosThreshold = (config.targetAcos || 30) * 3.5;
  } else if (['profit-focused', 'brand-defense', 'decline-management'].includes(goal)) {
    // 保守策略：更低的容忍度，但也不能太激进
    pauseSpendThreshold = 35;
    pauseClickThreshold = 15;
    maxAcosThreshold = (config.targetAcos || 30) * 2;
  } else if (['inventory-clearance', 'competitor-attack'].includes(goal)) {
    // 特殊策略：中等容忍度
    pauseSpendThreshold = 70;
    pauseClickThreshold = 30;
    maxAcosThreshold = (config.targetAcos || 30) * 3;
  }
  
  // v122g: 计算组平均AOV，用于动态调整花费阈值
  let totalSalesForAov = 0, totalOrdersForAov = 0;
  for (const c of campaigns) {
    totalSalesForAov += parseFloat(c.sales || '0');
    totalOrdersForAov += (c.orders || 0);
  }
  const groupAov = totalOrdersForAov > 0 ? totalSalesForAov / totalOrdersForAov : 30;
  // 花费阈值至少为1.5倍AOV，确保有足够数据判断
  pauseSpendThreshold = Math.max(pauseSpendThreshold, groupAov * 1.5);
  
  for (const campaign of campaigns) {
    try {
      // v163: 获取campaign级别的90天时间衰减加权数据，用于修正投放词状态决策
      let campaignTWMetrics: timeDecayService.TimeWeightedMetrics | null = null;
      try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 90);
        const rawDailyData = await db.getDailyPerformanceByDateRange(config.accountId, startDate, endDate, campaign.id);
        const dailyDataForWeighting: timeDecayService.DailyRawData[] = rawDailyData.map(d => ({
          date: typeof d.date === 'string' ? d.date : new Date(d.date).toISOString(),
          impressions: d.impressions || 0,
          clicks: d.clicks || 0,
          spend: parseFloat(String(d.spend || '0')),
          sales: parseFloat(String(d.sales || '0')),
          orders: d.orders || 0,
        }));
        if (dailyDataForWeighting.length > 0) {
          campaignTWMetrics = timeDecayService.calculateTimeWeightedMetrics(dailyDataForWeighting);
        }
      } catch (e: any) {
        console.log(`[KeywordStatus] v163: Campaign ${campaign.id} 时间衰减数据获取失败: ${e.message}`);
      }
      
      // 获取广告活动下的所有关键词
      const keywords = await db.getKeywordsByCampaignId(campaign.id);
      
      for (const keyword of keywords) {
        const spend = parseFloat(keyword.spend || '0');
        const sales = parseFloat(keyword.sales || '0');
        const clicks = keyword.clicks || 0;
        const conversions = keyword.orders || 0;
        const impressions = keyword.impressions || 0;
        const acos = sales > 0 ? (spend / sales * 100) : 0;
        
        // v163: 使用时间衰减加权修正投放词数据
        // 如果campaign整体趋势向好，提高暂停阈值（更保守）
        // 如果campaign整体趋势向差，降低暂停阈值（更积极清理）
        let trendAdjustedPauseSpendThreshold = pauseSpendThreshold;
        let trendAdjustedMaxAcosThreshold = maxAcosThreshold;
        if (campaignTWMetrics) {
          if (campaignTWMetrics.trendSignal.direction === 'improving') {
            trendAdjustedPauseSpendThreshold *= 1.3; // 趋势向好，更宽容
            trendAdjustedMaxAcosThreshold *= 1.2;
          } else if (campaignTWMetrics.trendSignal.direction === 'declining') {
            trendAdjustedPauseSpendThreshold *= 0.8; // 趋势向差，更严格
            trendAdjustedMaxAcosThreshold *= 0.85;
          }
        }
        
        // v122g: 多维度暂停判断（替代原来的粗暴硬编码阈值）
        let shouldPause = false;
        let pauseReason = '';
        
        if (keyword.keywordStatus === 'enabled') {
          // v163: 使用趋势修正后的阈值进行判断
          // 条件1：高花费零转化（使用趋势修正动态阈值）
          if (spend > trendAdjustedPauseSpendThreshold && conversions === 0 && clicks > pauseClickThreshold) {
            shouldPause = true;
            pauseReason = `高花费零转化: 花费$${spend.toFixed(2)}(>阈值$${trendAdjustedPauseSpendThreshold.toFixed(0)}), 点击${clicks}(>阈值${pauseClickThreshold}), 转化${conversions}`;
          }
          // 条件2：ACoS远超目标且数据充足
          else if (acos > trendAdjustedMaxAcosThreshold && clicks > pauseClickThreshold && conversions > 0) {
            shouldPause = true;
            pauseReason = `ACoS远超目标: ACoS ${acos.toFixed(1)}%(>阈值${trendAdjustedMaxAcosThreshold.toFixed(0)}%), 点击${clicks}, 转化${conversions}`;
          }
          
          // v122h: 探索期保护 - 新关键词在7天探索期内不执行暂停
          if (shouldPause && keyword.createdAt) {
            const keywordCreatedAt = new Date(keyword.createdAt);
            const isNew = isNewKeyword(keywordCreatedAt, clicks, impressions, 7);
            if (isNew) {
              shouldPause = false;
              const explorationInfo = getExplorationStrategy(keywordCreatedAt, clicks, impressions, parseFloat(keyword.bid || '0'));
              details.push({
                campaignId: campaign.id,
                campaignName: campaign.campaignName,
                keywordId: keyword.id,
                keywordText: keyword.keywordText,
                action: 'exploration_protect',
                reason: `[探索期保护] 关键词在探索期内(剩余${explorationInfo.explorationDaysRemaining}天)，策略:${explorationInfo.strategy}，不执行暂停`,
                currentStatus: keyword.keywordStatus,
              });
              continue;
            }
          }
          
          // v122h: 品牌词保护 - 品牌词不自动暂停，仅记录警告
          if (shouldPause) {
            const account = await db.getAdAccountById(config.accountId);
            const brandTerms = account?.storeName ? [account.storeName] : [];
            if (brandTerms.length > 0 && isProtectedKeyword(keyword.keywordText, brandTerms)) {
              shouldPause = false;
              details.push({
                campaignId: campaign.id,
                campaignName: campaign.campaignName,
                keywordId: keyword.id,
                keywordText: keyword.keywordText,
                action: 'brand_protect',
                reason: `[品牌词保护] 品牌关键词"${keyword.keywordText}"不自动暂停，建议人工评估`,
                currentStatus: keyword.keywordStatus,
              });
              continue;
            }
          }
          
          // v122g+h: 低数据量保护 - 如果数据量太少，不执行暂停，给予更多观察时间
          if (shouldPause && clicks < 10 && spend < groupAov) {
            shouldPause = false;
            details.push({
              campaignId: campaign.id,
              campaignName: campaign.campaignName,
              keywordId: keyword.id,
              keywordText: keyword.keywordText,
              action: 'observe',
              reason: `[观察期] 数据量不足(点击${clicks},花费$${spend.toFixed(2)})，继续观察而非直接暂停`,
              currentStatus: keyword.keywordStatus,
            });
            continue;
          }
        }
        
        // v122g: 更智能的启用判断
        let shouldEnable = false;
        let enableReason = '';
        
        if (keyword.keywordStatus === 'paused') {
          // 条件1：有转化且ACoS在目标范围内
          if (acos > 0 && acos < (config.targetAcos || 30)) {
            shouldEnable = true;
            enableReason = `表现改善: ACoS ${acos.toFixed(2)}%(目标${config.targetAcos || 30}%)`;
          }
          // v122g 条件2：历史CVR尚可，可以尝试重新探索
          else if (conversions > 0 && clicks > 5) {
            const cvr = conversions / clicks;
            if (cvr > 0.02) { // CVR > 2%说明有转化潜力
              shouldEnable = true;
              enableReason = `[探索模式重启] 历史CVR ${(cvr * 100).toFixed(1)}%尚可，尝试以探索性出价重新启用`;
            }
          }
        }
        
        if (shouldPause) {
          const action: any = {
            accountId: config.accountId,
            campaignId: campaign.id,
            campaignName: campaign.campaignName,
            keywordId: keyword.id,
            keywordText: keyword.keywordText,
            action: 'pause',
            reason: pauseReason,
            currentStatus: keyword.keywordStatus,
            newStatus: 'paused',
            apiSyncStatus: dryRun ? 'pending' : 'pending',
          };
          
          details.push(action);
          
          if (!dryRun) {
            // v148: 先调Amazon API确认成功，再更新本地数据库（先API后DB原则）
            try {
              const syncResult = await amazonApiHelper.syncKeywordStatusToAmazon(
                config.accountId,
                [{
                  keywordId: keyword.id,
                  newStatus: 'paused',
                  campaignId: campaign.id,
                  reason: pauseReason,
                  isProductTarget: false,
                }]
              );
              if (syncResult.success > 0) {
                // API成功后才更新本地DB
                await db.updateKeyword(keyword.id, { keywordStatus: 'paused' });
                pausedCount++;
                action.apiSyncStatus = 'synced';
                // v166: 注册状态变更验证任务
                try {
                  postOptVerifier.scheduleKeywordStatusVerification(
                    config.accountId,
                    [{ localKeywordId: keyword.id, amazonKeywordId: keyword.keywordId || String(keyword.id), expectedState: 'paused', adGroupId: keyword.adGroupId }]
                  );
                } catch (ve: any) { console.warn(`[KeywordStatusChange] v166: 验证任务注册失败: ${ve.message}`); }
              } else {
                // API失败，不更新本地DB
                action.apiSyncStatus = 'failed';
                if (syncResult.errors.length > 0) {
                  action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
                }
                console.warn(`[KeywordStatusChange] v148: API同步失败，跳过DB更新 (暂停 ${keyword.keywordText})`);
              }
            } catch (apiError: any) {
              action.apiSyncStatus = 'failed';
              action.apiSyncDetail = JSON.stringify({ error: apiError.message });
              console.error(`[KeywordStatusChange] v148: API同步失败，跳过DB更新 (暂停 ${keyword.keywordText}):`, apiError.message);
            }
          }
        } else if (shouldEnable) {
          const action: any = {
            accountId: config.accountId,
            campaignId: campaign.id,
            campaignName: campaign.campaignName,
            keywordId: keyword.id,
            keywordText: keyword.keywordText,
            action: 'enable',
            reason: enableReason,
            currentStatus: keyword.keywordStatus,
            newStatus: 'enabled',
            apiSyncStatus: dryRun ? 'pending' : 'pending',
          };
          
          details.push(action);
          
          if (!dryRun) {
            // v148: 先调Amazon API确认成功，再更新本地数据库（先API后DB原则）
            try {
              const syncResult = await amazonApiHelper.syncKeywordStatusToAmazon(
                config.accountId,
                [{
                  keywordId: keyword.id,
                  newStatus: 'enabled',
                  campaignId: campaign.id,
                  reason: enableReason,
                  isProductTarget: false,
                }]
              );
              if (syncResult.success > 0) {
                // API成功后才更新本地DB
                await db.updateKeyword(keyword.id, { keywordStatus: 'enabled' });
                enabledCount++;
                action.apiSyncStatus = 'synced';
                // v166: 注册状态变更验证任务
                try {
                  postOptVerifier.scheduleKeywordStatusVerification(
                    config.accountId,
                    [{ localKeywordId: keyword.id, amazonKeywordId: keyword.keywordId || String(keyword.id), expectedState: 'enabled', adGroupId: keyword.adGroupId }]
                  );
                } catch (ve: any) { console.warn(`[KeywordStatusChange] v166: 验证任务注册失败: ${ve.message}`); }
              } else {
                // API失败，不更新本地DB
                action.apiSyncStatus = 'failed';
                if (syncResult.errors.length > 0) {
                  action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
                }
                console.warn(`[KeywordStatusChange] v148: API同步失败，跳过DB更新 (启用 ${keyword.keywordText})`);
              }
            } catch (apiError: any) {
              action.apiSyncStatus = 'failed';
              action.apiSyncDetail = JSON.stringify({ error: apiError.message });
              console.error(`[KeywordStatusChange] v148: API同步失败，跳过DB更新 (启用 ${keyword.keywordText}):`, apiError.message);
            }
          }
        }
      }
    } catch (error: any) {
      details.push({
        campaignId: campaign.id,
        campaignName: campaign.campaignName,
        error: error.message,
      });
    }
  }
  
  return { executed: true, pausedCount, enabledCount, details };
}

/**
 * v135: 执行广告活动状态变更
 * 自动判断广告活动是否应该暂停或启用，并同步到Amazon
 */
async function executeCampaignStatusChanges(
  config: OptimizationTargetConfig,
  campaigns: any[],
  dryRun: boolean
): Promise<{ executed: boolean; pausedCount: number; enabledCount: number; details: any[] }> {
  const details: any[] = [];
  let pausedCount = 0;
  let enabledCount = 0;
  
  const goal = config.optimizationGoal || 'balanced';
  const targetAcos = config.targetAcos || 30;
  
  // 广告活动暂停阈值（比关键词更保守，因为影响范围更大）
  let campaignPauseSpendThreshold = 200;
  let campaignPauseClickThreshold = 100;
  let campaignMaxAcosThreshold = targetAcos * 3;
  
  if (['profit-focused', 'brand-defense', 'decline-management'].includes(goal)) {
    campaignPauseSpendThreshold = 150;
    campaignPauseClickThreshold = 80;
    campaignMaxAcosThreshold = targetAcos * 2.5;
  }
  
  for (const campaign of campaigns) {
    try {
      // v163: 获取campaign级别时间衰减加权数据
      let campaignTWMetrics: timeDecayService.TimeWeightedMetrics | null = null;
      try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 90);
        const rawDailyData = await db.getDailyPerformanceByDateRange(config.accountId, startDate, endDate, campaign.id);
        const dailyDataForWeighting: timeDecayService.DailyRawData[] = rawDailyData.map(d => ({
          date: typeof d.date === 'string' ? d.date : new Date(d.date).toISOString(),
          impressions: d.impressions || 0,
          clicks: d.clicks || 0,
          spend: parseFloat(String(d.spend || '0')),
          sales: parseFloat(String(d.sales || '0')),
          orders: d.orders || 0,
        }));
        if (dailyDataForWeighting.length > 0) {
          campaignTWMetrics = timeDecayService.calculateTimeWeightedMetrics(dailyDataForWeighting);
        }
      } catch (e: any) {
        console.log(`[CampaignStatus] v163: Campaign ${campaign.id} 时间衰减数据获取失败: ${e.message}`);
      }
      
      // v163: 优先使用时间衰减加权数据，而非简单汇总
      const spend = campaignTWMetrics ? campaignTWMetrics.weightedDailySpend * 30 : parseFloat(campaign.spend || '0');
      const sales = campaignTWMetrics ? campaignTWMetrics.weightedDailySales * 30 : parseFloat(campaign.sales || '0');
      const clicks = campaign.clicks || 0;
      const conversions = campaignTWMetrics ? Math.round(campaignTWMetrics.weightedDailyOrders * 30) : (campaign.orders || 0);
      const acos = campaignTWMetrics ? campaignTWMetrics.weightedAcos : (sales > 0 ? (spend / sales * 100) : 0);
      const campaignStatus = campaign.campaignStatus || 'enabled';
      
      // v163: 根据趋势修正广告活动暂停阈值
      let adjustedPauseSpendThreshold = campaignPauseSpendThreshold;
      let adjustedMaxAcosThreshold = campaignMaxAcosThreshold;
      if (campaignTWMetrics) {
        if (campaignTWMetrics.trendSignal.direction === 'improving') {
          adjustedPauseSpendThreshold *= 1.3;
          adjustedMaxAcosThreshold *= 1.2;
        } else if (campaignTWMetrics.trendSignal.direction === 'declining') {
          adjustedPauseSpendThreshold *= 0.8;
          adjustedMaxAcosThreshold *= 0.85;
        }
      }
      
      let shouldPause = false;
      let pauseReason = '';
      let shouldEnable = false;
      let enableReason = '';
      
      if (campaignStatus === 'enabled') {
        // v163: 使用趋势修正后的阈值
        // 条件1：高花费零转化
        if (spend > adjustedPauseSpendThreshold && conversions === 0 && clicks > campaignPauseClickThreshold) {
          shouldPause = true;
          pauseReason = `广告活动高花费零转化: 加权花费$${spend.toFixed(2)}(>阈值$${adjustedPauseSpendThreshold.toFixed(0)}), 加权点击${clicks}(>阈值${campaignPauseClickThreshold}), 加权转化${conversions}`;
        }
        // 条件2：ACoS远超目标
        else if (acos > adjustedMaxAcosThreshold && clicks > campaignPauseClickThreshold && conversions > 0) {
          shouldPause = true;
          pauseReason = `广告活动ACoS远超目标: 加权ACoS ${acos.toFixed(1)}%(>阈值${adjustedMaxAcosThreshold.toFixed(0)}%), 加权点击${clicks}, 加权转化${conversions}`;
        }
      } else if (campaignStatus === 'paused') {
        // v163: 使用时间衰减加权ACoS判断是否应启用
        if (acos > 0 && acos < targetAcos * 0.8) {
          shouldEnable = true;
          enableReason = `广告活动表现改善: 加权ACoS ${acos.toFixed(1)}%(目标${targetAcos}%), 建议重新启用`;
        }
      }
      
      if (shouldPause) {
        const action: any = {
          accountId: config.accountId,
          entityType: 'campaign',
          campaignId: campaign.id,
          campaignName: campaign.campaignName,
          amazonCampaignId: campaign.campaignId || campaign.amazonCampaignId,
          action: 'pause',
          reason: pauseReason,
          currentStatus: campaignStatus,
          newStatus: 'paused',
          spend: spend,
          sales: sales,
          clicks: clicks,
          conversions: conversions,
          acos: acos,
          apiSyncStatus: dryRun ? 'pending' : 'pending',
        };
        details.push(action);
        
        if (!dryRun) {
          // v148: 先调Amazon API确认成功，再更新本地数据库（先API后DB原则）
          try {
            const syncResult = await amazonApiHelper.syncCampaignStatusToAmazon(
              config.accountId,
              [{
                campaignId: campaign.id,
                amazonCampaignId: String(campaign.campaignId || campaign.amazonCampaignId || ''),
                newStatus: 'paused',
                campaignName: campaign.campaignName || '',
                reason: pauseReason,
              }]
            );
            if (syncResult.success > 0) {
              await db.updateCampaign(campaign.id, { campaignStatus: 'paused' });
              pausedCount++;
              action.apiSyncStatus = 'synced';
            } else {
              action.apiSyncStatus = 'failed';
              if (syncResult.errors.length > 0) {
                action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
              }
              console.warn(`[CampaignStatusChange] v148: API同步失败，跳过DB更新 (暂停 ${campaign.campaignName})`);
            }
          } catch (apiError: any) {
            action.apiSyncStatus = 'failed';
            action.apiSyncDetail = JSON.stringify({ error: apiError.message });
            console.error(`[CampaignStatusChange] v148: API同步失败，跳过DB更新 (暂停 ${campaign.campaignName}):`, apiError.message);
          }
        }
      } else if (shouldEnable) {
        const action: any = {
          accountId: config.accountId,
          entityType: 'campaign',
          campaignId: campaign.id,
          campaignName: campaign.campaignName,
          amazonCampaignId: campaign.campaignId || campaign.amazonCampaignId,
          action: 'enable',
          reason: enableReason,
          currentStatus: campaignStatus,
          newStatus: 'enabled',
          spend: spend,
          sales: sales,
          clicks: clicks,
          conversions: conversions,
          acos: acos,
          apiSyncStatus: dryRun ? 'pending' : 'pending',
        };
        details.push(action);
        
        if (!dryRun) {
          // v148: 先调Amazon API确认成功，再更新本地数据库（先API后DB原则）
          try {
            const syncResult = await amazonApiHelper.syncCampaignStatusToAmazon(
              config.accountId,
              [{
                campaignId: campaign.id,
                amazonCampaignId: String(campaign.campaignId || campaign.amazonCampaignId || ''),
                newStatus: 'enabled',
                campaignName: campaign.campaignName || '',
                reason: enableReason,
              }]
            );
            if (syncResult.success > 0) {
              await db.updateCampaign(campaign.id, { campaignStatus: 'enabled' });
              enabledCount++;
              action.apiSyncStatus = 'synced';
            } else {
              action.apiSyncStatus = 'failed';
              if (syncResult.errors.length > 0) {
                action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
              }
              console.warn(`[CampaignStatusChange] v148: API同步失败，跳过DB更新 (启用 ${campaign.campaignName})`);
            }
          } catch (apiError: any) {
            action.apiSyncStatus = 'failed';
            action.apiSyncDetail = JSON.stringify({ error: apiError.message });
            console.error(`[CampaignStatusChange] v148: API同步失败，跳过DB更新 (启用 ${campaign.campaignName}):`, apiError.message);
          }
        }
      }
    } catch (error: any) {
      details.push({
        campaignId: campaign.id,
        campaignName: campaign.campaignName,
        entityType: 'campaign',
        error: error.message,
      });
    }
  }
  
  return { executed: true, pausedCount, enabledCount, details };
}

/**
 * v135: 执行广告组状态变更
 * 自动判断广告组是否应该暂停或启用，并同步到Amazon
 */
async function executeAdGroupStatusChanges(
  config: OptimizationTargetConfig,
  campaigns: any[],
  dryRun: boolean
): Promise<{ executed: boolean; pausedCount: number; enabledCount: number; details: any[] }> {
  const details: any[] = [];
  let pausedCount = 0;
  let enabledCount = 0;
  
  const targetAcos = config.targetAcos || 30;
  
  // 广告组暂停阈值（介于广告活动和关键词之间）
  let adGroupPauseSpendThreshold = 100;
  let adGroupPauseClickThreshold = 50;
  let adGroupMaxAcosThreshold = targetAcos * 2.8;
  
  for (const campaign of campaigns) {
    try {
      const adGroups = await db.getAdGroupsByCampaignId(campaign.id);
      
      for (const adGroup of adGroups) {
        const spend = parseFloat(adGroup.spend || '0');
        const sales = parseFloat(adGroup.sales || '0');
        const clicks = adGroup.clicks || 0;
        const conversions = adGroup.orders || 0;
        const acos = sales > 0 ? (spend / sales * 100) : 0;
        const adGroupStatus = adGroup.adGroupStatus || 'enabled';
        
        let shouldPause = false;
        let pauseReason = '';
        let shouldEnable = false;
        let enableReason = '';
        
        if (adGroupStatus === 'enabled') {
          if (spend > adGroupPauseSpendThreshold && conversions === 0 && clicks > adGroupPauseClickThreshold) {
            shouldPause = true;
            pauseReason = `广告组高花费零转化: 花费$${spend.toFixed(2)}(>阈值$${adGroupPauseSpendThreshold}), 点击${clicks}(>阈值${adGroupPauseClickThreshold}), 转化${conversions}`;
          } else if (acos > adGroupMaxAcosThreshold && clicks > adGroupPauseClickThreshold && conversions > 0) {
            shouldPause = true;
            pauseReason = `广告组ACoS远超目标: ACoS ${acos.toFixed(1)}%(>阈值${adGroupMaxAcosThreshold.toFixed(0)}%), 点击${clicks}, 转化${conversions}`;
          }
        } else if (adGroupStatus === 'paused') {
          if (acos > 0 && acos < targetAcos * 0.8) {
            shouldEnable = true;
            enableReason = `广告组表现改善: ACoS ${acos.toFixed(1)}%(目标${targetAcos}%), 建议重新启用`;
          }
        }
        
        if (shouldPause) {
          const action: any = {
            accountId: config.accountId,
            entityType: 'adGroup',
            campaignId: campaign.id,
            campaignName: campaign.campaignName,
            adGroupId: adGroup.id,
            adGroupName: adGroup.adGroupName,
            amazonAdGroupId: adGroup.adGroupId,
            action: 'pause',
            reason: pauseReason,
            currentStatus: adGroupStatus,
            newStatus: 'paused',
            spend: spend,
            sales: sales,
            clicks: clicks,
            conversions: conversions,
            acos: acos,
            apiSyncStatus: dryRun ? 'pending' : 'pending',
          };
          details.push(action);
          
          if (!dryRun) {
            await db.updateAdGroupStatus(adGroup.id, 'paused');
            pausedCount++;
            
            try {
              const syncResult = await amazonApiHelper.syncAdGroupStatusToAmazon(
                config.accountId,
                [{
                  adGroupId: adGroup.id,
                  amazonAdGroupId: String(adGroup.adGroupId || ''),
                  newStatus: 'paused',
                  adGroupName: adGroup.adGroupName || '',
                  campaignName: campaign.campaignName || '',
                  reason: pauseReason,
                }]
              );
              action.apiSyncStatus = syncResult.success > 0 ? 'synced' : 'failed';
              if (syncResult.errors.length > 0) {
                action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
              }
            } catch (apiError: any) {
              action.apiSyncStatus = 'failed';
              action.apiSyncDetail = JSON.stringify({ error: apiError.message });
            }
          }
        } else if (shouldEnable) {
          const action: any = {
            accountId: config.accountId,
            entityType: 'adGroup',
            campaignId: campaign.id,
            campaignName: campaign.campaignName,
            adGroupId: adGroup.id,
            adGroupName: adGroup.adGroupName,
            amazonAdGroupId: adGroup.adGroupId,
            action: 'enable',
            reason: enableReason,
            currentStatus: adGroupStatus,
            newStatus: 'enabled',
            spend: spend,
            sales: sales,
            clicks: clicks,
            conversions: conversions,
            acos: acos,
            apiSyncStatus: dryRun ? 'pending' : 'pending',
          };
          details.push(action);
          
          if (!dryRun) {
            await db.updateAdGroupStatus(adGroup.id, 'enabled');
            enabledCount++;
            
            try {
              const syncResult = await amazonApiHelper.syncAdGroupStatusToAmazon(
                config.accountId,
                [{
                  adGroupId: adGroup.id,
                  amazonAdGroupId: String(adGroup.adGroupId || ''),
                  newStatus: 'enabled',
                  adGroupName: adGroup.adGroupName || '',
                  campaignName: campaign.campaignName || '',
                  reason: enableReason,
                }]
              );
              action.apiSyncStatus = syncResult.success > 0 ? 'synced' : 'failed';
              if (syncResult.errors.length > 0) {
                action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
              }
            } catch (apiError: any) {
              action.apiSyncStatus = 'failed';
              action.apiSyncDetail = JSON.stringify({ error: apiError.message });
            }
          }
        }
      }
    } catch (error: any) {
      details.push({
        campaignId: campaign.id,
        campaignName: campaign.campaignName,
        entityType: 'adGroup',
        error: error.message,
      });
    }
  }
  
  return { executed: true, pausedCount, enabledCount, details };
}

/**
 * 执行中央竞价协调
 * 收集bidOptimizer、daypartingService、placementService的建议
 * 计算理论最高CPC并实施熔断机制
 */
async function executeBidCoordination(
  config: OptimizationTargetConfig,
  campaigns: any[],
  bidDetails: any[],
  placementDetails: any[],
  daypartingDetails: any[],
  dryRun: boolean
): Promise<{ executed: boolean; campaignsCoordinated: number; circuitBreakerTriggered: number; details: any[] }> {
  const details: any[] = [];
  let campaignsCoordinated = 0;
  let circuitBreakerTriggered = 0;
  
  // 按广告活动分组处理
  for (const campaign of campaigns) {
    try {
      const proposals: bidCoordinator.BidProposal[] = [];
      
      // 1. 收集出价优化建议
      const bidSuggestions = bidDetails.filter(d => d.campaignId === campaign.id);
      for (const suggestion of bidSuggestions) {
        if (suggestion.newBid && suggestion.currentBid) {
          const multiplier = suggestion.newBid / suggestion.currentBid;
          proposals.push(bidCoordinator.createBidProposal(
            campaign.id,
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
      const placementSuggestions = placementDetails.filter(d => d.campaignId === campaign.id);
      for (const suggestion of placementSuggestions) {
        if (suggestion.suggestedMultiplier !== undefined) {
          proposals.push(bidCoordinator.createBidProposal(
            campaign.id,
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
      const daypartingSuggestions = daypartingDetails.filter(d => d.campaignId === campaign.id);
      for (const suggestion of daypartingSuggestions) {
        if (suggestion.bidMultiplier && suggestion.bidMultiplier !== 1) {
          proposals.push(bidCoordinator.createBidProposal(
            campaign.id,
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
        campaign.campaignId || campaign.id.toString(),
        config.accountId,
        proposals,
        currentBaseBid,
        currentPlacementMultiplier,
        currentDaypartingMultiplier
      );
      
      // 6. 记录协调结果
      const coordinationDetail = {
        campaignId: campaign.id,
        campaignName: campaign.campaignName,
        proposalsCount: proposals.length,
        originalBaseBid: coordinatedResult.originalBaseBid,
        finalBaseBid: coordinatedResult.finalBaseBid,
        theoreticalMaxCPC: coordinatedResult.theoreticalMaxCPC,
        effectiveMultiplier: coordinatedResult.effectiveMultiplier,
        circuitBreakerTriggered: coordinatedResult.circuitBreakerTriggered,
        circuitBreakerReason: coordinatedResult.circuitBreakerReason,
        warnings: coordinatedResult.warnings,
      };
      
      details.push(coordinationDetail);
      campaignsCoordinated++;
      
      if (coordinatedResult.circuitBreakerTriggered) {
        circuitBreakerTriggered++;
      }
      
      // 7. 如果不是干运行且有实际调整，记录日志
      if (!dryRun && coordinatedResult.finalBaseBid !== coordinatedResult.originalBaseBid) {
        console.log(`[BidCoordination] 广告活动 ${campaign.campaign.campaignName} 价协调完成:`, {
          original: coordinatedResult.originalBaseBid,
          final: coordinatedResult.finalBaseBid,
          maxCPC: coordinatedResult.theoreticalMaxCPC,
          circuitBreaker: coordinatedResult.circuitBreakerTriggered,
        });
      }
    } catch (error: any) {
      details.push({
        campaignId: campaign.id,
        campaignName: campaign.campaignName,
        error: error.message,
      });
    }
  }
  
  return { executed: true, campaignsCoordinated, circuitBreakerTriggered, details };
}

/**
 * 记录执行日志
 */
async function recordExecutionLog(result: OptimizationExecutionResult): Promise<void> {
  const dbInstance = await db.getDb();
  if (!dbInstance) return;
  
  try {
    const { optimizationLogs } = await import('../drizzle/schema');
    const now = new Date().toISOString();
    
    // v140: 记录出价调整日志（每条日志使用该条目自身的同步状态）
    if (result.bidOptimization.executed && result.bidOptimization.adjustmentsCount > 0) {
      console.log(`[recordExecutionLog] v140: 出价调整日志: details=${result.bidOptimization.details.length}`);
      
      for (const detail of result.bidOptimization.details) {
        // v140: 使用每条调整的独立同步状态（synced/failed/pending）
        const itemSyncStatus = detail.apiSyncStatus || 'pending';
        const itemSyncDetail = detail.apiSyncDetail || null;
        
        // 解析单条同步详情中的错误信息
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
          await dbInstance.insert(optimizationLogs).values({
            performanceGroupId: result.targetId,
            performanceGroupName: result.targetName,
            accountId: result.accountId || detail.accountId || 0, // v167: 优先使用result.accountId
            logCategory: 'bid_adjustment',
            actionType: detail.newBid > detail.currentBid ? 'bid_increase' : 'bid_decrease',
            campaignId: detail.campaignId,
            campaignName: detail.campaignName,
            actionDetail: JSON.stringify(detail),
            previousValue: `$${detail.currentBid.toFixed(2)}`,
            newValue: `$${detail.newBid.toFixed(2)}`,
            changeReason: detail.reason || `出价调整 ${detail.changePercent}%`,
            status: itemSyncStatus === 'synced' ? 'success' : itemSyncStatus === 'failed' ? 'failed' : 'success',
            apiSyncStatus: itemSyncStatus,
            apiSyncDetail: itemSyncDetail,
            apiSyncedAt: itemSyncStatus === 'synced' ? now : null,
            errorMessage: itemErrorMessage,
            createdAt: now,
            executedAt: now,
          });
        } catch (insertError: any) {
          console.error(`[recordExecutionLog] 出价日志写入失败: ${insertError.message}`, { keywordId: detail.keywordId, itemSyncStatus });
        }
      }
    }
    
    // 记录位置调整日志（包含Amazon API同步状态）
    if (result.placementOptimization.executed && result.placementOptimization.adjustmentsCount > 0) {
      for (const detail of result.placementOptimization.details) {
        await dbInstance.insert(optimizationLogs).values({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          accountId: result.accountId || detail.accountId || 0, // v167: 优先使用result.accountId
          logCategory: 'placement_adjustment',
          actionType: 'placement_adjust',
          campaignId: detail.campaignId,
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
    
    // 记录搜索词分析日志（否定词和新关键词，包含API同步状态）
    if (result.searchTermAnalysis.executed) {
      for (const detail of result.searchTermAnalysis.details) {
        const actionType = detail.action === 'add_negative' ? 'negative_keyword_add' : 'keyword_create';
        await dbInstance.insert(optimizationLogs).values({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          accountId: result.accountId || detail.accountId || 0, // v167: 优先使用result.accountId
          logCategory: 'optimization_settings',
          actionType: actionType,
          campaignId: detail.campaignId,
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(detail),
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
    
    // v134: 记录分时竞价日志（包含API同步状态）
    if (result.daypartingOptimization.executed && result.daypartingOptimization.adjustmentsCount > 0) {
      for (const detail of result.daypartingOptimization.details) {
        await dbInstance.insert(optimizationLogs).values({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          accountId: result.accountId || detail.accountId || 0, // v167: 优先使用result.accountId
          logCategory: 'bid_adjustment',
          actionType: 'dayparting_bid',
          campaignId: detail.campaignId,
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(detail),
          previousValue: `$${detail.baseBid?.toFixed(2) || '0.00'}`,
          newValue: `$${detail.adjustedBid?.toFixed(2) || '0.00'}`,
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
    
    // v134: 记录预算分配日志（包含API同步状态）
    if (result.budgetAllocation.executed && result.budgetAllocation.adjustmentsCount > 0) {
      for (const detail of result.budgetAllocation.details) {
        await dbInstance.insert(optimizationLogs).values({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          accountId: result.accountId || detail.accountId || 0, // v167: 优先使用result.accountId
          logCategory: 'bid_adjustment',
          actionType: 'budget_adjustment',
          campaignId: detail.campaignId,
          campaignName: detail.campaignName,
          actionDetail: JSON.stringify(detail),
          previousValue: `$${detail.currentBudget?.toFixed(2) || '0.00'}`,
          newValue: `$${detail.suggestedBudget?.toFixed(2) || '0.00'}`,
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
    
    // 记录投放词状态变更日志（包含API同步状态）
    if (result.keywordStatusChanges.executed) {
      for (const detail of result.keywordStatusChanges.details) {
        await dbInstance.insert(optimizationLogs).values({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          accountId: result.accountId || detail.accountId || 0, // v167: 优先使用result.accountId
          logCategory: 'bid_adjustment',
          actionType: detail.action === 'add_negative' ? 'negative_keyword_add' : detail.newStatus === 'paused' ? 'target_pause' : 'target_enable',
          campaignId: detail.campaignId,
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
    
    // v135: 记录广告活动状态变更日志
    if (result.campaignStatusChanges.executed) {
      for (const detail of result.campaignStatusChanges.details) {
        if (detail.error) continue; // 跳过错误记录
        await dbInstance.insert(optimizationLogs).values({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          accountId: result.accountId || detail.accountId || 0, // v167: 优先使用result.accountId
          logCategory: 'bid_adjustment',
          actionType: detail.newStatus === 'paused' ? 'bid_decrease' : 'bid_increase',
          campaignId: detail.campaignId,
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
    
    // v135: 记录广告组状态变更日志
    if (result.adGroupStatusChanges.executed) {
      for (const detail of result.adGroupStatusChanges.details) {
        if (detail.error) continue; // 跳过错误记录
        await dbInstance.insert(optimizationLogs).values({
          performanceGroupId: result.targetId,
          performanceGroupName: result.targetName,
          accountId: result.accountId || detail.accountId || 0, // v167: 优先使用result.accountId
          logCategory: 'optimization_settings',
          actionType: detail.action === 'pause' ? 'adgroup_pause' : 'adgroup_enable',
          campaignId: detail.campaignId,
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
    
    // v139: 更新优化目标的 last_optimization_at 时间戳
    try {
      const { performanceGroups } = await import('../drizzle/schema');
      const { eq: eqOp } = await import('drizzle-orm');
      await dbInstance.update(performanceGroups)
        .set({ lastOptimizationAt: new Date() } as any)
        .where(eqOp(performanceGroups.id, result.targetId));
      console.log(`[OptimizationTargetEngine] 已更新 last_optimization_at: targetId=${result.targetId}`);
    } catch (updateErr: any) {
      // 如果Drizzle ORM的casing映射有问题，使用mysql2直接更新
      try {
        const mysql2 = await import('mysql2/promise');
        const dbUrl = process.env.DATABASE_URL;
        if (dbUrl) {
          const directConn = await mysql2.createConnection(dbUrl);
          await directConn.execute(
            'UPDATE performance_groups SET last_optimization_at = NOW() WHERE id = ?',
            [result.targetId]
          );
          await directConn.end();
          console.log(`[OptimizationTargetEngine] 已通过mysql2更新 last_optimization_at: targetId=${result.targetId}`);
        }
      } catch (directErr: any) {
        console.error(`[OptimizationTargetEngine] 更新last_optimization_at失败: ${directErr.message}`);
      }
    }
    
    console.log(`[OptimizationTargetEngine] 执行日志已写入数据库: ${result.targetName}`, {
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
  } catch (error: any) {
    console.error(`[OptimizationTargetEngine] 日志写入失败:`, error.message);
    // 回退到console.log
    console.log(`[OptimizationTargetEngine] 执行完成(日志回退): ${result.targetName}`, {
      status: result.status,
      errors: result.errors.length,
    });
  }
}

/**
 * 获取所有启用的优化目标
 */
export async function getEnabledOptimizationTargets(accountId?: number): Promise<OptimizationTargetConfig[]> {
  const dbInstance = await db.getDb();
  if (!dbInstance) return [];
  
  const groups = accountId 
    ? await db.getPerformanceGroupsByAccountId(accountId)
    : await db.getPerformanceGroupsByAccountId(0);
  
  const configs: OptimizationTargetConfig[] = [];
  
  for (const group of groups) {
    // 只执行 status='active' 且 autoOptimize 开启的优化目标
    if (group.status === 'active' && (group as any).autoOptimize !== 0) {
      const config = await getOptimizationTargetConfig(group.id);
      if (config) {
        configs.push(config);
      }
    }
  }
  
  return configs;
}

/**
 * 批量执行所有启用的优化目标
 * v122: 支持 specificModules 参数，实现模块隔离执行
 */
export async function executeAllEnabledTargets(
  accountId?: number,
  options: { dryRun?: boolean; specificModules?: string[] } = {}
): Promise<OptimizationExecutionResult[]> {
  const targets = await getEnabledOptimizationTargets(accountId);
  const results: OptimizationExecutionResult[] = [];
  
  const modulesDesc = options.specificModules?.length ? options.specificModules.join(',') : 'all';
  console.log(`[OptimizationTargetEngine] 批量执行 ${targets.length} 个优化目标, 模块: ${modulesDesc}`);
  
  for (const target of targets) {
    try {
      const result = await executeOptimizationTarget(target.id, options);
      results.push(result);
    } catch (error: any) {
      results.push({
        targetId: target.id,
        targetName: target.name,
        accountId: target.accountId, // v167
        executionTime: new Date(),
        status: 'failed',
        bidOptimization: { executed: false, adjustmentsCount: 0, details: [] },
        placementOptimization: { executed: false, adjustmentsCount: 0, details: [] },
        daypartingOptimization: { executed: false, adjustmentsCount: 0, details: [] },
        searchTermAnalysis: { executed: false, negativeKeywordsAdded: 0, newKeywordsAdded: 0, details: [] },
        budgetAllocation: { executed: false, adjustmentsCount: 0, details: [] },
        keywordStatusChanges: { executed: false, pausedCount: 0, enabledCount: 0, details: [] },
        campaignStatusChanges: { executed: false, pausedCount: 0, enabledCount: 0, details: [] },
        adGroupStatusChanges: { executed: false, pausedCount: 0, enabledCount: 0, details: [] },
        multiDimensionOptimization: { executed: false, campaignsAnalyzed: 0, rulesGenerated: 0, details: [] },
        bidCoordination: { executed: false, campaignsCoordinated: 0, circuitBreakerTriggered: 0, details: [] },
        errors: [error.message],
        warnings: [],
      });
    }
  }
  
  return results;
}

/**
 * v143: 获取优化目标的生命周期信息（供调度器查询）
 */
export async function getTargetLifecycleInfo(targetId: number): Promise<{
  overallStage: campaignLifecycleService.LifecycleStage;
  config: campaignLifecycleService.LifecycleOptimizationConfig;
  summary: string;
  campaigns: campaignLifecycleService.CampaignLifecycleInfo[];
}> {
  return campaignLifecycleService.getTargetLifecycleStage(targetId);
}

/**
 * 获取优化目标的执行摘要
 */
export async function getOptimizationTargetSummary(targetId: number): Promise<{
  config: OptimizationTargetConfig | null;
  campaignsCount: number;
  keywordsCount: number;
  lastExecution?: OptimizationExecutionResult;
  pendingActions: {
    bidAdjustments: number;
    placementAdjustments: number;
    negativeKeywords: number;
    budgetAdjustments: number;
  };
}> {
  const config = await getOptimizationTargetConfig(targetId);
  if (!config) {
    return {
      config: null,
      campaignsCount: 0,
      keywordsCount: 0,
      pendingActions: {
        bidAdjustments: 0,
        placementAdjustments: 0,
        negativeKeywords: 0,
        budgetAdjustments: 0,
      },
    };
  }
  
  const campaigns = await db.getCampaignsByPerformanceGroupId(targetId);
  let keywordsCount = 0;
  
  for (const campaign of campaigns) {
    const keywords = await db.getKeywordsByCampaignId(campaign.id);
    keywordsCount += keywords.length;
  }
  
  // 执行干运行获取待处理操作数量
  const dryRunResult = await executeOptimizationTarget(targetId, { dryRun: true, forceExecution: true });
  
  return {
    config,
    campaignsCount: campaigns.length,
    keywordsCount,
    pendingActions: {
      bidAdjustments: dryRunResult.bidOptimization.details.length,
      placementAdjustments: dryRunResult.placementOptimization.details.length,
      negativeKeywords: dryRunResult.searchTermAnalysis.negativeKeywordsAdded,
      budgetAdjustments: dryRunResult.budgetAllocation.details.length,
    },
  };
}
