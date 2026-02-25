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
import { eq, sql } from "drizzle-orm";
import * as bidOptimizer from "./bidOptimizer";
import * as daypartingService from "./daypartingService";
import * as placementOptimizationService from "./placementOptimizationService";
import { preOptimizationSafetyCheck, applyBidGuardrail, applyBudgetGuardrail, applyPlacementGuardrail, SAFETY_LIMITS } from './optimizationSafetyGuardrails';
import * as adAutomation from "./adAutomation";
import * as intelligentBudgetAllocationService from "./intelligentBudgetAllocationService";
import * as bidCoordinator from "./services/bidCoordinator";
import * as nextGenOrchestrator from "./nextGenBidOrchestrator";
import * as amazonApiHelper from "./services/amazonApiHelper";
import { acquireAccountOptimizationLock, releaseAccountOptimizationLock, getModuleLockGroup } from "./utils/lockManager";
import * as amazonIdResolver from "./services/amazonIdResolver";
import { getLocalHour, getLocalDayOfWeek, isNewKeyword, getExplorationStrategy, isProtectedKeyword } from "./algorithmUtils";
import * as campaignLifecycleService from "./services/campaignLifecycleService";
import * as timeDecayService from "./timeDecayWeightedDataService";
import * as gradualEngine from "./gradualOptimizationEngine";
import * as selfEvolution from "./selfEvolutionEngine";
import * as multiDimOptimizer from "./multiDimensionOptimizer";
import * as multiDimComboAnalyzer from "./multiDimComboAnalyzer";
import * as postOptVerifier from "./postOptimizationVerifier";
import { registerActiveTask, unregisterActiveTask, isShuttingDown } from "./utils/taskLifecycle";
import { decideTargeting } from "./services/targetingAlgorithm";
import type { SearchTermPerformance, TargetingDecision } from "./services/targetingAlgorithm";
import { sanitizeAndValidateKeyword, canAddPositiveKeyword, isAsinSearchTerm, adGroupHasProductTargets } from "./utils/keywordValidator";
import { createModuleLogger } from './utils/logger';
import { getCampaignAmazonId, getCampaignLocalId } from './utils/idTypes';

const log = createModuleLogger('TargetEngine');

// 缓存账号站点信息，避免重复查询
const marketplaceCache = new Map<number, string>();

async function getAccountMarketplace(accountId: number): Promise<string> {
  if (marketplaceCache.has(accountId)) return marketplaceCache.get(accountId)!;
  const account = await db.getAdAccountById(accountId);
  const marketplace = account?.marketplace || 'US';
  marketplaceCache.set(accountId, marketplace);
  return marketplace;
}

// v221: 获取账户最后同步时间，用于数据新鲜度检查
async function getLastSyncTimeForAccount(accountId: number): Promise<Date | null> {
  try {
    const account = await db.getAdAccountById(accountId);
    if (account && (account as any).lastSyncAt) {
      return new Date((account as any).lastSyncAt);
    }
    // 备用：从同步日志表查询
    const { getEngineStatus } = await import('./unifiedSyncEngine');
    const status = getEngineStatus();
    if ((status as any).lastSyncResults) {
      const accountResult = ((status as any).lastSyncResults as any[])?.find((r: any) => r.accountId === accountId);
      if (accountResult?.completedAt) {
        return new Date(accountResult.completedAt);
      }
    }
    return null;
  } catch {
    return null;
  }
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
  
  // v179: 分时预算优化
  daypartingBudgetOptimization: {
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
    log.debug(`[OptimizationTargetConfig] 目标 ${group.name} 生命周期: ${lifecycle.overallStage} (${lifecycle.summary})`);
  } catch (lcErr: any) {
    log.error(`[OptimizationTargetConfig] 生命周期查询失败: ${lcErr.message}`);
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
  
  // v181: 获取账户+模块级优化锁，不同模块类型可以并行执行
  const moduleLockGroup = getModuleLockGroup(specificModules);
  if (!dryRun && !acquireAccountOptimizationLock(config.accountId, `optimizationTarget:${targetId}`, moduleLockGroup)) {
    throw new Error(`账户 ${config.accountId} 模块组 ${moduleLockGroup} 优化锁已被占用，跳过本次执行`);
  }
  const shouldReleaseLock = !dryRun;
  
  // v185: 检查系统是否正在关闭，避免在关闭过程中启动新的优化任务
  if (isShuttingDown() && !forceExecution) {
    if (shouldReleaseLock) releaseAccountOptimizationLock(config.accountId, moduleLockGroup);
    throw new Error(`系统正在关闭，跳过优化目标 ${config.name} 的执行`);
  }
  
  // v185: 注册活跃任务，确保优雅关闭时能等待完成
  const activeTaskId = registerActiveTask(`优化目标执行: ${config.name}`, {
    targetId: config.id,
    accountId: config.accountId,
    module: specificModules?.join(',') || 'all',
  });
  
  const result: OptimizationExecutionResult = {
    targetId: config.id,
    targetName: config.name,
    accountId: config.accountId, // v167: 传递accountId到日志记录
    executionTime: new Date(),
    status: 'success',
    bidOptimization: { executed: false, adjustmentsCount: 0, details: [] },
    placementOptimization: { executed: false, adjustmentsCount: 0, details: [] },
    daypartingOptimization: { executed: false, adjustmentsCount: 0, details: [] },
    daypartingBudgetOptimization: { executed: false, adjustmentsCount: 0, details: [] }, // v179
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
    log.debug(`[OptimizationTarget] 目标 ${config.name} 当前生命周期: ${config.lifecycleStage} | 出价调整上限: ±${config.maxBidChangePercent}% | ${config.lifecycleSummary}`);
  }
  
  // v162: 执行前安全护栏检查
  try {
    const safetyCheck = await preOptimizationSafetyCheck(config.accountId, targetId);
    if (!safetyCheck.safe) {
      result.warnings.push(...safetyCheck.warnings);
      log.warn(`[OptimizationTarget] v162 安全护栏触发: ${safetyCheck.warnings.join('; ')}`);
      // 紧急制动时不完全阻止执行，但记录警告并降低调整幅度
    }
  } catch (safetyErr: any) {
    log.warn(`[OptimizationTarget] v162 安全检查异常，继续执行: ${safetyErr.message}`);
  }
  
  // v221: 数据新鲜度检查 - 确保不基于过时数据做优化决策
  try {
    const lastSyncTime = await getLastSyncTimeForAccount(config.accountId);
    if (lastSyncTime) {
      const dataAgeMinutes = (Date.now() - lastSyncTime.getTime()) / (1000 * 60);
      if (dataAgeMinutes > 120 && !forceExecution) {
        // 数据超过2小时未同步，警告但不阻止执行
        const staleMsg = `v221: 数据新鲜度警告 - 账户 ${config.accountId} 最后同步于 ${Math.round(dataAgeMinutes)} 分钟前，优化决策可能基于过时数据`;
        log.warn(`[OptimizationTarget] ${staleMsg}`);
        result.warnings.push(staleMsg);
      }
      if (dataAgeMinutes > 360 && !forceExecution) {
        // 数据超过6小时未同步，先触发同步再执行优化
        const criticalMsg = `v221: 数据严重过时 - 账户 ${config.accountId} 最后同步于 ${Math.round(dataAgeMinutes)} 分钟前，尝试触发紧急同步`;
        log.warn(`[OptimizationTarget] ${criticalMsg}`);
        result.warnings.push(criticalMsg);
        try {
          const { syncAllAccounts } = await import('./unifiedSyncEngine');
          await syncAllAccounts('high');
          log.info(`[OptimizationTarget] v221: 紧急同步完成，继续执行优化`);
        } catch (syncErr: any) {
          log.warn(`[OptimizationTarget] v221: 紧急同步失败，仍继续执行: ${syncErr.message}`);
        }
      }
    }
  } catch (freshnessErr: any) {
    log.warn(`[OptimizationTarget] v221: 数据新鲜度检查异常: ${freshnessErr.message}`);
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
      log.info(`[OptimizationTarget] v164 进化周期完成: 评估${evolutionReport.totalActionsEvaluated}个动作, ` +
        `正面${evolutionReport.positiveActions}, 负面${evolutionReport.negativeActions}, ` +
        `纠错${evolutionReport.correctionsExecuted}个, 趋势: ${evolutionReport.improvementTrend}`);
      if (evolutionReport.correctionsExecuted > 0) {
        result.warnings.push(`自我进化: 自动纠正了${evolutionReport.correctionsExecuted}个不合理优化`);
      }
    }
    
    // 获取自适应优化参数（根据历史成功率动态调整）
    adaptiveParams = await selfEvolution.getAdaptiveOptimizationParams(targetId, config.strategyTemplateId);
    if (adaptiveParams) {
      log.debug(`[OptimizationTarget] v164 自适应参数: 最大出价提升${Math.round(adaptiveParams.maxBidIncrease * 100)}%, ` +
        `最大出价降低${Math.round(adaptiveParams.maxBidDecrease * 100)}%, ` +
        `成功率${Math.round(adaptiveParams.recentSuccessRate * 100)}%`);
    }
  } catch (evoErr: any) {
    log.warn(`[OptimizationTarget] v164 自我进化异常，继续执行: ${evoErr.message}`);
  }
  
  // 获取优化目标下的所有广告活动
  const allCampaigns = await db.getCampaignsByPerformanceGroupId(targetId);
  if (allCampaigns.length === 0) {
    result.warnings.push('优化目标下没有广告活动');
    if (shouldReleaseLock) releaseAccountOptimizationLock(config.accountId, moduleLockGroup);
    unregisterActiveTask(activeTaskId); // v185
    return result;
  }
  
  // v156: 只对enabled状态的campaign执行优化
  // paused/archived的campaign在Amazon端不会投放广告，对其做出价调整是无效的
  const campaigns = allCampaigns.filter(c => (c as any).campaignStatus === 'enabled');
  const skippedCampaigns = allCampaigns.length - campaigns.length;
  if (skippedCampaigns > 0) {
    log.info(`[OptimizationTarget] v156: 跳过${skippedCampaigns}个非enabled状态的campaign (总${allCampaigns.length}个, enabled=${campaigns.length}个)`);
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
          await db.updatePerformanceGroup(targetId, { autoOptimize: 0 });
          const pauseMsg = `v168: 优化目标"${config.name}"已自动暂停 - 所有${allCampaigns.length}个广告活动均为暂停/归档状态，不再执行自动优化`;
          log.debug(`[OptimizationTarget] ${pauseMsg}`);
          result.warnings.push(pauseMsg);
          result.status = 'skipped';
        } catch (autoPauseErr: any) {
          log.error(`[OptimizationTarget] v168: 自动暂停优化目标失败:`, autoPauseErr.message);
        }
      }
    }
    
    if (shouldReleaseLock) releaseAccountOptimizationLock(config.accountId, moduleLockGroup);
    unregisterActiveTask(activeTaskId); // v185
    return result;
  }

  // v141: 统一Pre-Sync ID Resolution - 确保所有Amazon ID就绪
  // 在执行任何优化操作前，自动回填缺失的keywordId和targetId
  if (!dryRun) {
    try {
      const idResolution = await amazonIdResolver.ensureAmazonIdsReady(config.accountId);
      if (idResolution.totalMissingBefore > 0) {
        const resolvedTotal = idResolution.keywordsResolved + idResolution.keywordsCreated + idResolution.keywordsCleanedUp + idResolution.productTargetsResolved;
        log.info(`[OptimizationTarget] Pre-Sync ID Resolution: 处理了${idResolution.totalMissingBefore}个缺失ID, 解决${resolvedTotal}个, 剩余${idResolution.totalMissingAfter}个`);
        if (idResolution.totalMissingAfter > 0) {
          result.warnings.push(`Pre-Sync ID Resolution: 仍有${idResolution.totalMissingAfter}个实体缺少Amazon ID`);
        }
      }
    } catch (idErr: any) {
      log.error(`[OptimizationTarget] Pre-Sync ID Resolution异常: ${idErr.message}`);
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
      log.info(`[OptimizationTarget] 多维度优化完成: 分析${multiDimResults.campaignsAnalyzed}个campaign, 生成${multiDimResults.rulesGenerated}条规则`);
    } catch (error: any) {
      result.errors.push(`多维度智能优化失败: ${error.message}`);
      log.error(`[OptimizationTarget] 多维度优化异常:`, error.message);
    }
  }
  
  // 2.7 v183: 执行多维度组合分析（投放词 × 位置 × 时间段）
  // 基于keywordPlacementHourlyPerformance交叉维度数据，识别黄金/铅石/潜力组合
  if (config.enableDaypartingOptimization && shouldExecute('combo_analysis')) {
    try {
      const dbConn = await getDb();
      if (dbConn) {
        const campaignIds = campaigns.map(c => c.id);
        const comboResults = await multiDimComboAnalyzer.executeMultiDimComboAnalysis(
          dbConn,
          config.accountId,
          campaignIds,
          {
            targetAcos: config.targetAcos,
            lookbackDays: 30,
          }
        );
        log.info(`[OptimizationTarget] v183 多维度组合分析完成: ${comboResults.campaignsAnalyzed}个campaign, ` +
          `${comboResults.totalCombosFound}个组合 (黄金:${comboResults.goldenCount}, 铅石:${comboResults.leadenCount}, ` +
          `潜力:${comboResults.potentialCount}, 标准:${comboResults.standardCount})`);
        
        // 将组合分析结果注入到多维度优化结果中
        if (result.multiDimensionOptimization) {
          (result.multiDimensionOptimization as any).comboAnalysis = {
            goldenCount: comboResults.goldenCount,
            leadenCount: comboResults.leadenCount,
            potentialCount: comboResults.potentialCount,
            standardCount: comboResults.standardCount,
          };
        }
      }
    } catch (error: any) {
      log.error(`[OptimizationTarget] v183 多维度组合分析异常:`, error.message);
      result.warnings.push(`多维度组合分析失败: ${error.message}`);
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
  
  // 3.5 v179: 执行分时预算优化（根据星期几调整预算）
  if (config.enableDaypartingOptimization && shouldExecute('dayparting_budget')) {
    try {
      const daypartingBudgetResults = await executeDaypartingBudgetOptimization(config, campaigns, dryRun);
      result.daypartingBudgetOptimization = daypartingBudgetResults;
    } catch (error: any) {
      result.errors.push(`分时预算优化失败: ${error.message}`);
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
              campaignId: detail.localCampaignId,
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
              campaignId: detail.localCampaignId,
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
              targetEntityId: detail.localCampaignId,
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
      
      // v189: 收集搜索词分析中失败的关键词创建和否定关键词任务
      // 这是之前遗漏的关键入队逻辑，导致关键词创建同步率仅57.8%，否定关键词同步率0%
      if (result.searchTermAnalysis?.details) {
        for (const detail of result.searchTermAnalysis.details) {
          if (detail.apiSyncStatus === 'failed') {
            if (detail.action === 'add_negative') {
              // v201: 否定关键词创建失败 → 入队 negative_keyword 类型
              // 修复: detail.campaignId是本地ID，需要查找Amazon campaignId
              const negCampaign = campaigns.find((c: any) => c.id === detail.localCampaignId);
              const negAmazonCampaignId = negCampaign?.campaignId || null;
              failedTasks.push({
                batchId,
                optimizationTargetId: config.id,
                accountId: config.accountId,
                taskType: 'negative_keyword',
                priority: 1,
                targetEntityType: 'campaign',
                targetEntityId: detail.localCampaignId,
                amazonEntityId: detail.amazonCampaignId || (negAmazonCampaignId ? String(negAmazonCampaignId) : null),
                targetEntityName: detail.searchTerm,
                action: detail.matchType === 'negative_exact' ? 'negativeExact' : 'negativePhrase',
                oldValue: '',
                newValue: detail.searchTerm,
                changeReason: detail.reason || '否定关键词创建重试',
                campaignId: detail.localCampaignId,
                campaignName: detail.campaignName,
                adGroupId: detail.adGroupId || null,
              });
            } else if (detail.action === 'add_keyword') {
              // 新关键词创建失败 → 入队 new_keyword 类型
              failedTasks.push({
                batchId,
                optimizationTargetId: config.id,
                accountId: config.accountId,
                taskType: 'new_keyword',
                priority: 1,
                targetEntityType: 'keyword',
                targetEntityId: detail.localKeywordId || 0,
                amazonEntityId: null,
                targetEntityName: detail.searchTerm,
                action: `create_${detail.matchType || 'exact'}`,
                oldValue: '',
                newValue: String(detail.bid || 0.50),
                changeReason: detail.reason || '关键词创建重试',
                campaignId: detail.localCampaignId,
                campaignName: detail.campaignName,
                adGroupId: detail.adGroupId || null,
              });
            }
          }
        }
      }
      
      // v189: 收集预算调整中失败的任务
      // 之前遗漏导致预算调整同步率仅18.7%
      if (result.budgetAllocation?.details) {
        for (const detail of result.budgetAllocation.details) {
          if (detail.apiSyncStatus === 'failed') {
            const campaign = campaigns.find((c: any) => c.id === detail.localCampaignId);
            failedTasks.push({
              batchId,
              optimizationTargetId: config.id,
              accountId: config.accountId,
              taskType: 'budget_adjustment',
              priority: 1,
              targetEntityType: 'campaign',
              targetEntityId: detail.localCampaignId,
              amazonEntityId: detail.amazonCampaignId || campaign?.campaignId || String(detail.localCampaignId),
              targetEntityName: detail.campaignName,
              action: 'budget_update',
              oldValue: String(detail.currentBudget),
              newValue: String(detail.suggestedBudget),
              changeReason: detail.reason || '预算调整重试',
              campaignId: detail.localCampaignId,
              campaignName: detail.campaignName,
            });
          }
        }
      }
      
      // v189: 收集位置倾斜调整中失败的任务
      if (result.placementOptimization?.details) {
        for (const detail of result.placementOptimization.details) {
          if (detail.apiSyncStatus === 'failed') {
            const campaign = campaigns.find((c: any) => c.id === detail.localCampaignId);
            failedTasks.push({
              batchId,
              optimizationTargetId: config.id,
              accountId: config.accountId,
              taskType: 'placement_adjustment',
              priority: 2,
              targetEntityType: 'campaign',
              targetEntityId: detail.localCampaignId,
              amazonEntityId: detail.amazonCampaignId || campaign?.campaignId || String(detail.localCampaignId),
              targetEntityName: detail.campaignName,
              action: detail.placement || 'placement_adjust',
              oldValue: detail.previousValue || '',
              newValue: detail.newValue || '',
              changeReason: detail.reason || '位置倾斜调整重试',
              campaignId: detail.localCampaignId,
              campaignName: detail.campaignName,
            });
          }
        }
      }
      
      // v189: 收集分时预算调整中失败的任务
      if (result.daypartingBudgetOptimization?.details) {
        for (const detail of result.daypartingBudgetOptimization.details) {
          if (detail.apiSyncStatus === 'failed') {
            const campaign = campaigns.find((c: any) => c.id === detail.localCampaignId);
            failedTasks.push({
              batchId,
              optimizationTargetId: config.id,
              accountId: config.accountId,
              taskType: 'budget_adjustment',
              priority: 1,
              targetEntityType: 'campaign',
              targetEntityId: detail.localCampaignId,
              amazonEntityId: detail.amazonCampaignId || campaign?.campaignId || String(detail.localCampaignId),
              targetEntityName: detail.campaignName,
              action: 'dayparting_budget',
              oldValue: String(detail.currentBudget || detail.baseBudget || ''),
              newValue: String(detail.adjustedBudget || detail.newBudget || ''),
              changeReason: detail.reason || '分时预算调整重试',
              campaignId: detail.localCampaignId,
              campaignName: detail.campaignName,
            });
          }
        }
      }
      
      // v189: 收集分时竞价调整中失败的任务
      if (result.daypartingOptimization?.details) {
        for (const detail of result.daypartingOptimization.details) {
          if (detail.apiSyncStatus === 'failed') {
            failedTasks.push({
              batchId,
              optimizationTargetId: config.id,
              accountId: config.accountId,
              taskType: 'bid_adjustment',
              priority: 2,
              targetEntityType: detail.isProductTarget ? 'product_target' : 'keyword',
              targetEntityId: detail.keywordId || detail.targetId,
              amazonEntityId: null,
              targetEntityName: detail.keywordText || detail.targetName,
              action: 'dayparting_bid',
              oldValue: String(detail.baseBid || detail.previousBid || ''),
              newValue: String(detail.adjustedBid || detail.newBid || ''),
              changeReason: detail.reason || '分时竞价调整重试',
              campaignId: detail.localCampaignId,
              campaignName: detail.campaignName,
            });
          }
        }
      }
      
      if (failedTasks.length > 0) {
        await enqueueTasks(failedTasks);
        log.warn(`[OptimizationTarget] v137: ${failedTasks.length}个失败任务已入队重试队列, batchId=${batchId}`);
        result.retryBatchId = batchId;
        result.retryTaskCount = failedTasks.length;
      }
    } catch (enqueueErr: any) {
      log.error(`[OptimizationTarget] v137: 入队失败任务异常: ${enqueueErr.message}`);
    }
  }
  
  // v221: 优化目标执行完成后触发确认同步，确保所有直接API调用路径的变更被回读
  try {
    const affectedEntities: string[] = [];
    if (result.bidOptimization && result.bidOptimization.adjustmentsCount > 0) affectedEntities.push('keywords');
    if (result.placementOptimization && result.placementOptimization.adjustmentsCount > 0) affectedEntities.push('campaigns');
    if (result.daypartingOptimization && result.daypartingOptimization.adjustmentsCount > 0) affectedEntities.push('keywords');
    if (result.daypartingBudgetOptimization && result.daypartingBudgetOptimization.adjustmentsCount > 0) affectedEntities.push('budgets');
    if (result.searchTermAnalysis && (result.searchTermAnalysis.negativeKeywordsAdded > 0 || result.searchTermAnalysis.newKeywordsAdded > 0)) affectedEntities.push('keywords');
    if (result.budgetAllocation && result.budgetAllocation.adjustmentsCount > 0) affectedEntities.push('budgets');
    if (result.keywordStatusChanges && (result.keywordStatusChanges.pausedCount > 0 || result.keywordStatusChanges.enabledCount > 0)) affectedEntities.push('keywords');
    if (result.campaignStatusChanges && (result.campaignStatusChanges.pausedCount > 0 || result.campaignStatusChanges.enabledCount > 0)) affectedEntities.push('campaigns');
    
    if (affectedEntities.length > 0) {
      const uniqueEntities = [...new Set(affectedEntities)];
      const { confirmationSync } = await import('./unifiedSyncEngine');
      // 异步触发，不阻塞优化流程返回
      confirmationSync(config.accountId, uniqueEntities as any[], `optimizationTarget_${config.id}`).then(syncResult => {
        if (syncResult) {
          log.info(`[OptimizationTarget] v221: 确认同步完成 - 账户 ${config.accountId}, 目标 ${config.id}: ${syncResult.completedSteps}/${syncResult.totalSteps}步成功`);
        }
      }).catch(err => {
        log.warn(`[OptimizationTarget] v221: 确认同步失败 - 账户 ${config.accountId}: ${err.message}`);
      });
    }
  } catch (confirmErr: any) {
    log.warn(`[OptimizationTarget] v221: 触发确认同步异常: ${confirmErr.message}`);
  }
  
  // v181: 释放账户+模块级优化锁
  if (shouldReleaseLock) releaseAccountOptimizationLock(config.accountId, moduleLockGroup);
  
  // v185: 注销活跃任务
  unregisterActiveTask(activeTaskId);
  
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
    // v170: 传入策略模板名称，用于策略感知的参数差异化
    strategyTemplate: config.strategyTemplateId,
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
    log.info(`[BidOptimization] v164: 自适应参数已注入 - 最大提升${Math.round(evoParams.maxBidIncrease * 100)}%, 最大降低${Math.round(evoParams.maxBidDecrease * 100)}%, 成功率${Math.round(evoParams.recentSuccessRate * 100)}%`);
  } catch (e: any) {
    log.warn(`[BidOptimization] v164: 自适应参数获取失败，使用默认值: ${e.message}`);
  }
  
  const currentDate = new Date();
  // v165: maxBidLimit严格使用用户配置的max_bid为绝对红线
  // CPC广告默认上限$2.00，VCPM广告默认上限$15.00
  const cpcMaxBidLimit = config.maxBid || 2.00;
  const vcpmMaxBidLimit = config.maxBid ? config.maxBid * 5 : 15.00; // VCPM出价单位是每千次展示，通常是CPC的3-10倍
  log.info(`[BidOptimization] v165: CPC最高出价=$${cpcMaxBidLimit} | VCPM最高出价=$${vcpmMaxBidLimit} (用户设置max_bid=${config.maxBid || '未设置'})`);
  log.debug(`[BidOptimization] v165: 日预算=${config.dailyBudget || '未设置'}, 目标ACoS=${config.targetAcos || '未设置'}`);
  
  for (const campaign of campaigns) {
    // v206: 统一ID提取 — 在循环开头一次性提取，后续代码统一使用
    const campaignLocalId = getCampaignLocalId(campaign);   // int PK，用于本地DB更新
    const campaignAmazonId = getCampaignAmazonId(campaign); // varchar，用于查询和API调用
    
    // v163: 获取campaign级别的90天历史每日数据，用于时间衰减加权分析
    let campaignDailyData: Array<{ date: Date; spend: number; sales: number; clicks: number; orders: number }> = [];
    let campaignTimeWeightedMetrics: timeDecayService.TimeWeightedMetrics | null = null;
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 90); // v163: 从14天扩展到90天
      const rawDailyData = await db.getDailyPerformanceByDateRange(config.accountId, startDate, endDate, campaignAmazonId);
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
      log.debug(`[BidOptimization] v163: Campaign ${campaignLocalId} 时间衰减加权 - 加权ACoS=${campaignTimeWeightedMetrics.weightedAcos.toFixed(1)}%, 加权ROAS=${campaignTimeWeightedMetrics.weightedRoas.toFixed(2)}, 置信度=${campaignTimeWeightedMetrics.dataQuality.confidenceLevel}, 趋势=${campaignTimeWeightedMetrics.trendSignal.direction}`);
    } catch (e: any) {
      log.warn(`[BidOptimization] 获取campaign ${campaignLocalId} 历史数据失败: ${e.message}`);
    }
    
    // v163: 安全检查 - 检测异常信号
    if (campaignTimeWeightedMetrics) {
      const safetyCheck = gradualEngine.performSafetyCheck(campaignTimeWeightedMetrics);
            if (safetyCheck.shouldPause) {
        log.warn(`[BidOptimization] v163: Campaign ${campaignLocalId} 安全检查触发暂停: ${safetyCheck.reason}`);
        details.push({
          localCampaignId: campaignLocalId,
          amazonCampaignId: campaignAmazonId,
          campaignName: campaign.campaignName,
          action: 'safety_pause',
          reason: `[安全检查] ${safetyCheck.warnings.join('；')}`,
        });

        // v232: 紧急止损 - 如果安全检查建议暂停，则暂停整个优化目标
        try {
          await db.updatePerformanceGroup(config.id, { autoOptimize: 0 });
          const pauseMsg = `v232: 优化目标 "${config.name}" 已被安全系统自动暂停 - Campaign ${campaign.campaignName} 触发严重风险信号: ${safetyCheck.reason}`;
          log.error(`[OptimizationTarget] ${pauseMsg}`);
          result.errors.push(pauseMsg);
          result.status = 'failed';
          // 立即释放锁并返回，终止当前所有优化
          if (shouldReleaseLock) releaseAccountOptimizationLock(config.accountId, moduleLockGroup);
          unregisterActiveTask(activeTaskId);
          return result;
        } catch (autoPauseErr: any) {
          log.error(`[OptimizationTarget] v232: 自动暂停优化目标失败:`, autoPauseErr.message);
        }

        continue; // 跳过该campaign的竞价优化
      }
      if (safetyCheck.warnings.length > 0) {
        log.info(`[BidOptimization] v163: Campaign ${campaignLocalId} 安全警告: ${safetyCheck.warnings.join('；')}`);
      }
    }
    
    // v165: 根据campaign的costType动态设置maxBidLimit（CPC vs VCPM）
    const isVcpmCampaign = (campaign as any).costType === 'vcpm';
    const maxBidLimit = isVcpmCampaign ? vcpmMaxBidLimit : cpcMaxBidLimit;
    if (isVcpmCampaign) {
      log.info(`[BidOptimization] v165: Campaign ${campaignLocalId} 识别为VCPM广告，使用VCPM最高出价$${maxBidLimit}`);
    }
    
    // v122h: 收集该campaign下所有关键词，构建EnhancedOptimizationTarget
    const keywords = await db.getKeywordsByCampaignId(campaignAmazonId);
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
          log.info(`[BidOptimization] v166: 跳过关键词 ${keyword.id} "${keyword.keywordText}" - 冷却期内(${hoursSinceOptimized.toFixed(1)}h), 出价待确认 pending=$${(keyword as any).pendingBid}`);
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
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
      });
    }
    
    // v198: NextGen统一出价引擎 — 100%使用NextGen算法，内部自动降级，无需回退到旧算法
    if (keywordTargets.length > 0) {
      const nextGenResults = await nextGenOrchestrator.batchCalculateNextGenBids(
        config.accountId, keywordTargets, bidConfig, maxBidLimit
      );
      
      for (const nextGenResult of nextGenResults) {
        // NextGen保证每个target都有结果，无需null检查
        let finalBid = nextGenResult.newBid;
        
        // 绝对红线校验（双重保险）
        finalBid = Math.min(finalBid, maxBidLimit);
        finalBid = Math.max(finalBid, 0.02);
        finalBid = Math.round(finalBid * 100) / 100;
        
        if (nextGenResult.actionType !== 'hold' && Math.abs(finalBid - nextGenResult.previousBid) > 0.01) {
          const keyword = keywords.find(k => k.id === nextGenResult.targetId);
          details.push({
            keywordId: nextGenResult.targetId,
            keywordText: keyword?.keywordText || `关键词 ${nextGenResult.targetId}`,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            campaignName: campaign.campaignName,
            currentBid: nextGenResult.previousBid,
            newBid: finalBid,
            changePercent: ((finalBid - nextGenResult.previousBid) / nextGenResult.previousBid * 100).toFixed(2),
            reason: nextGenResult.reason,
            algorithmUsed: nextGenResult.algorithmUsed,
            confidenceScore: nextGenResult.confidence,
            algorithmTier: nextGenResult.algorithmTier,
          });
          if (!dryRun) adjustmentsCount++;
        }
      }
    }
    
    // v122h: 商品定向也使用UCB增强版算法
    const adGroupsList = await db.getAdGroupsByCampaignId(campaignAmazonId);
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
          localCampaignId: campaignLocalId,
          amazonCampaignId: campaignAmazonId,
        });
      }
    }
    
    // v198: 商品定向也使用NextGen统一出价引擎 — 100%覆盖，无回退
    if (productTargets.length > 0) {
      const nextGenPtResults = await nextGenOrchestrator.batchCalculateNextGenBids(
        config.accountId, productTargets, bidConfig, maxBidLimit
      );
      
      for (const nextGenResult of nextGenPtResults) {
        let finalBid = nextGenResult.newBid;
        
        // 绝对红线校验（双重保险）
        finalBid = Math.min(finalBid, maxBidLimit);
        finalBid = Math.max(finalBid, 0.02);
        finalBid = Math.round(finalBid * 100) / 100;
        
        if (nextGenResult.actionType !== 'hold' && Math.abs(finalBid - nextGenResult.previousBid) > 0.01) {
          const target = allTargets.find(t => t.id === nextGenResult.targetId);
          details.push({
            keywordId: nextGenResult.targetId, // v230: 保持向后兼容，商品定向也用keywordId字段传递本地ID
            productTargetId: nextGenResult.targetId, // v230: 新增显式的productTargetId字段
            keywordText: target?.targetText || target?.targetValue || `商品定向 ${nextGenResult.targetId}`,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            campaignName: campaign.campaignName,
            currentBid: nextGenResult.previousBid,
            newBid: finalBid,
            changePercent: ((finalBid - nextGenResult.previousBid) / nextGenResult.previousBid * 100).toFixed(2),
            reason: `商品定向 - ${nextGenResult.reason}`,
            isProductTarget: true,
            algorithmUsed: nextGenResult.algorithmUsed,
            confidenceScore: nextGenResult.confidence,
            algorithmTier: nextGenResult.algorithmTier,
          });
          if (!dryRun) adjustmentsCount++;
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
      
      // v224: 过滤掉safety_pause等非出价调整记录，它们没有keywordId和newBid字段
      const syncableDetails = details.filter(d => d.keywordId && d.newBid !== undefined && d.action !== 'safety_pause');
      const nonSyncableDetails = details.filter(d => !d.keywordId || d.newBid === undefined || d.action === 'safety_pause');
      
      if (nonSyncableDetails.length > 0) {
        log.info(`[BidOptimization] v224: ${nonSyncableDetails.length}条非出价调整记录(safety_pause等)已跳过API同步`);
        for (const d of nonSyncableDetails) {
          d.apiSyncStatus = 'not_applicable';
          d.apiSyncDetail = JSON.stringify({ status: 'not_applicable', error: null, reason: '非出价调整记录(safety_pause)' });
        }
      }
      
      apiSyncResult = await amazonApiHelper.syncBidAdjustmentsToAmazon(
        accountId,
        syncableDetails.map(d => ({
          keywordId: d.keywordId,
          newBid: d.newBid,
          campaignId: d.amazonCampaignId,
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
      
      log.warn(`[BidOptimization] Amazon API同步: 成功=${apiSyncResult.success}, 失败=${apiSyncResult.failed}, 状态=${apiSyncStatus}`);
      if (apiSyncResult.errors.length > 0) {
        log.error(`[BidOptimization] Amazon API同步错误:`, apiSyncResult.errors.join('; '));
      }
      
      // v148: API调用成功后，才更新本地数据库（先API后DB原则）
      // v148: 使用事务保护批量DB更新，确保原子性
      // v224: 只从可同步的details中过滤，避免safety_pause等非出价调整记录干扰
      const syncedDetails = syncableDetails.filter(d => {
        const itemResult = apiSyncResult.itemResults?.get(d.keywordId);
        return itemResult?.status === 'synced';
      });
      const skippedDetails = syncableDetails.filter(d => {
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
                    .set({ bid: (typeof detail.newBid === 'number' ? detail.newBid : 0).toFixed(2) })
                    .where(eq(productTargetsTable.id, detail.keywordId));
                } else {
                  // v166: 更新bid的同时，标记pending状态和优化时间
                  await tx.update(keywordsTable)
                    .set({
                      bid: (typeof detail.newBid === 'number' ? detail.newBid : 0).toFixed(2),
                      lastOptimizedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
                      pendingBid: (typeof detail.newBid === 'number' ? detail.newBid : 0).toFixed(2),
                      bidSyncStatus: 'pending_confirmation',
                    } as any)
                    .where(eq(keywordsTable.id, detail.keywordId));
                }
              }
              // v178/v206: 更新所有受影响的campaigns的last_optimized_at（使用本地int ID）
              const affectedCampaignIds = [...new Set(syncedDetails.map(d => d.localCampaignId))];
              const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
              for (const cid of affectedCampaignIds) {
                await tx.update(campaignsTable)
                  .set({ lastOptimizedAt: nowStr } as any)
                  .where(eq(campaignsTable.id, cid));
              }
            });
            log.info(`[BidOptimization] v178: 事务批量DB更新成功: ${syncedDetails.length}条出价 + campaigns.last_optimized_at已更新`);
            
            // v230: 记录出价-绩效历史数据到 bidPerformanceHistory 表，为Sigmoid曲线拟合提供训练数据
            try {
              const { batchRecordBidPerformanceHistory } = await import('./rlDataRecorder');
              const bidPerfRecords = syncedDetails.map(d => ({
                accountId: config.accountId,
                campaignId: String(d.amazonCampaignId || d.localCampaignId),
                bidObjectType: (d.isProductTarget ? 'asin' : 'keyword') as 'keyword' | 'asin',
                bidObjectId: d.keywordId,
                bid: typeof d.newBid === 'number' ? d.newBid : 0,
              }));
              const bphResult = await batchRecordBidPerformanceHistory(bidPerfRecords);
              log.info(`[BidOptimization] v230: bidPerformanceHistory写入: recorded=${bphResult.recorded}, failed=${bphResult.failed}`);
            } catch (bphErr: any) {
              log.warn(`[BidOptimization] v230: bidPerformanceHistory写入失败(不阻塞主流程): ${bphErr.message}`);
            }
          } catch (txErr: any) {
            log.error(`[BidOptimization] v178: 事务DB更新失败(已回滚): ${txErr.message}`);
            // 事务失败时，所有DB更新自动回滚，保持数据一致性
          }
        }
      }
      
      for (const detail of skippedDetails) {
        log.warn(`[BidOptimization] v148: API同步失败，跳过DB更新: targetId=${detail.keywordId}`);
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
              campaignId: d.amazonCampaignId,
              adGroupId: d.adGroupId,
              isProductTarget: d.isProductTarget || false,
            }))
          );
          log.info(`[BidOptimization] v166: 已注册${syncedDetails.length}个出价验证任务`);
        } catch (verifyErr: any) {
          log.warn(`[BidOptimization] v166: 注册验证任务失败(不影响主流程): ${verifyErr.message}`);
        }
      }
    } catch (apiError: any) {
      apiSyncStatus = 'failed';
      apiSyncResult.errors.push(apiError.message);
      log.error(`[BidOptimization] Amazon API同步异常:`, apiError.message);
      // v148: API整体异常，不更新任何本地DB记录
      log.error(`[BidOptimization] v148: API整体异常，所有本地DB更新已跳过`);
    }
  } else if (dryRun) {
    apiSyncStatus = 'pending'; // 模拟模式不同步
  }
  
  // v140: 将每条调整的独立同步状态附加到详情中（而非批量状态）
  // v224: 跳过已在前面设置了apiSyncStatus的非出价调整记录(safety_pause等)
  for (const detail of details) {
    if (detail.apiSyncStatus === 'not_applicable') continue; // v224: safety_pause等已处理
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
  
  // v183: 预加载多维度组合分析结果，用于智能位置倾斜
  let accountComboMap = new Map<number, any[]>(); // campaignId -> comboAnalysis[]
  try {
    const dbConn = await getDb();
    if (dbConn) {
      const allCombos = await multiDimComboAnalyzer.getComboAnalysisForAccount(dbConn, config.accountId);
      for (const combo of allCombos) {
        if (!accountComboMap.has(combo.campaignId)) {
          accountComboMap.set(combo.campaignId, []);
        }
        accountComboMap.get(combo.campaignId)!.push(combo);
      }
      log.info(`[PlacementOptimization] v183: 加载${allCombos.length}个投放词的组合分析结果`);
    }
  } catch (comboErr: any) {
    log.warn(`[PlacementOptimization] v183: 加载组合分析结果失败: ${comboErr.message}`);
  }

  for (const campaign of campaigns) {
    const campaignLocalId = getCampaignLocalId(campaign);
    const campaignAmazonId = getCampaignAmazonId(campaign);
    try {
      // v186: 修复campaignId MISMATCH - placement_performance表存储的是本地ID(campaigns.id)
      // 本地数据库查询必须使用本地ID，Amazon API调用使用Amazon ID
      const localCampaignIdStr = String(campaignLocalId);
      
      // 分析位置表现（使用本地ID查询placement_performance表）
      const analysis = await placementOptimizationService.analyzePlacementPerformance(campaignLocalId as any, config.accountId);
      
      // 生成位置调整建议（使用本地ID查询placement_performance表）
      const suggestions = await placementOptimizationService.generatePlacementSuggestions(
        campaignLocalId as any,
        config.accountId
      );
      
      // v183: 基于多维度组合分析智能调整位置倾斜
      const campaignCombos = accountComboMap.get(campaignLocalId) || [];
      const goldenCombos = campaignCombos.filter((c: any) => c.comboCategory === 'golden' && c.confidenceLevel !== 'insufficient');
      
      // 统计黄金组合中各位置的表现
      let topOfSearchGoldenCount = 0;
      let productPageGoldenCount = 0;
      for (const combo of goldenCombos) {
        if (combo.bestPlacement === 'top_of_search') topOfSearchGoldenCount++;
        if (combo.bestPlacement === 'product_page') productPageGoldenCount++;
      }
      
      for (const suggestion of suggestions) {
        // v183: 如果多维度分析显示某个位置有大量黄金组合，则增强该位置的倾斜
        let comboAdjustedMultiplier = suggestion.suggestedMultiplier;
        let comboReason = '';
        
        if (goldenCombos.length > 0) {
          if (suggestion.placement === 'top_of_search' && topOfSearchGoldenCount > goldenCombos.length * 0.5) {
            // 超过50%黄金组合的最佳位置是搜索顶部，增强搜索顶部倾斜
            const boost = Math.min(suggestion.suggestedMultiplier * 0.10, 20); // 最多额外+20%
            comboAdjustedMultiplier = Math.min(suggestion.suggestedMultiplier + boost, 900); // Amazon上限900%
            comboReason = ` [v183: ${topOfSearchGoldenCount}个黄金组合偏好搜索顶部, +${boost.toFixed(0)}%]`;
          } else if (suggestion.placement === 'product_page' && productPageGoldenCount > goldenCombos.length * 0.5) {
            const boost = Math.min(suggestion.suggestedMultiplier * 0.10, 20);
            comboAdjustedMultiplier = Math.min(suggestion.suggestedMultiplier + boost, 900);
            comboReason = ` [v183: ${productPageGoldenCount}个黄金组合偏好商品页, +${boost.toFixed(0)}%]`;
          }
        }
        
        const adjustment: any = {
          accountId: config.accountId,
          localCampaignId: campaignLocalId,
          amazonCampaignId: campaignAmazonId,
          campaignName: campaign.campaignName,
          placement: suggestion.placement,
          currentMultiplier: suggestion.currentMultiplier,
          suggestedMultiplier: comboAdjustedMultiplier,
          originalSuggestedMultiplier: suggestion.suggestedMultiplier,
          reason: suggestion.reason + comboReason,
          apiSyncStatus: dryRun ? 'pending' : 'pending',
          comboGoldenCount: goldenCombos.length,
        };
        
        details.push(adjustment);
        
        if (!dryRun && comboAdjustedMultiplier !== suggestion.currentMultiplier) {
          // v186: 本地记录使用本地ID
          await placementOptimizationService.applyPlacementAdjustment(
            campaignLocalId as any,
            config.accountId,
            { ...suggestion, suggestedMultiplier: comboAdjustedMultiplier }
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
          log.error(`[PlacementOptimization] Amazon API同步失败 (Campaign ${campaign.campaignName}):`, apiError.message);
        }
        
        // v134: 将同步状态回写到该campaign的所有detail中
        for (const d of details.filter(d => d.localCampaignId === campaignLocalId)) {
          d.apiSyncStatus = placementSyncSuccess ? 'synced' : (placementSyncError ? 'failed' : 'pending');
          d.apiSyncDetail = placementSyncError ? JSON.stringify({ error: placementSyncError }) : null;
        }
        
        // v166: 注册位置倾斜验证任务
        if (placementSyncSuccess) {
          try {
            // v186: 验证任务中也使用正确的Amazon Campaign ID
            const amazonCampaignIdForVerify = campaignAmazonId;
            const topSuggestion = suggestions?.find((s: any) => s.placement === 'top_of_search');
            const productSuggestion = suggestions?.find((s: any) => s.placement === 'product_page');
            postOptVerifier.schedulePlacementVerification(
              config.accountId,
              [{
                localCampaignId: campaignLocalId,
                amazonCampaignId: amazonCampaignIdForVerify,
                expectedTopOfSearch: topSuggestion?.suggestedMultiplier,
                expectedProductPage: productSuggestion?.suggestedMultiplier,
              }]
            );
          } catch (verifyErr: any) {
            log.warn(`[PlacementOptimization] v166: 注册验证任务失败(不影响主流程): ${verifyErr.message}`);
          }
        }
      }
    } catch (error: any) {
      details.push({
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
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
  
  // v183: 预加载多维度组合分析结果，用于分投放词分时竞价
  let comboAnalysisMap = new Map<number, any>(); // keywordId -> comboAnalysis
  try {
    const dbConn = await getDb();
    if (dbConn) {
      const comboResults = await multiDimComboAnalyzer.getComboAnalysisForAccount(dbConn, config.accountId);
      for (const combo of comboResults) {
        if (combo.keywordId) {
          comboAnalysisMap.set(combo.keywordId, combo);
        }
      }
      log.info(`[DaypartingOptimization] v183: 加载${comboAnalysisMap.size}个投放词的多维度组合分析结果`);
    }
  } catch (comboErr: any) {
    log.warn(`[DaypartingOptimization] v183: 加载组合分析结果失败，使用统一乘数: ${comboErr.message}`);
  }
  
  // v183: 最高出价红线
  const maxBidLimit = config.maxBid || 2.00;
  
  for (const campaign of campaigns) {
    const campaignLocalId = getCampaignLocalId(campaign);
    const campaignAmazonId = getCampaignAmazonId(campaign);
    try {
      // v157: 修复分时策略查找 - 按campaignId查找，并自动创建缺失的策略
      let strategy = await daypartingService.getDaypartingStrategyByCampaignId(campaignAmazonId);
      if (!strategy) {
        strategy = await daypartingService.ensureDaypartingStrategy(
          config.accountId,
          campaignAmazonId,
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
      const hourlyRule = await daypartingService.getHourlyRule(strategy.id, currentDayOfWeek, currentHour);
      if (!hourlyRule) continue;
      
      // 基础分时乘数（广告活动级别）
      const baseDaypartingMultiplier = parseFloat(hourlyRule.bidMultiplier || '1.00');
      
      // 获取广告活动下的所有关键词
      const keywords = await db.getKeywordsByCampaignId(campaignAmazonId);
      
      for (const keyword of keywords) {
        if (keyword.keywordStatus !== 'enabled') continue;
        
        const baseBid = parseFloat(keyword.bid || '0');
        if (baseBid <= 0) continue;
        
        // v183: 多维度资源倾斜算法
        // 最终竞价 = 基础出价 × 分时乘数 × 投放词个性化时间乘数
        let comboTimeMultiplier = 1.0;
        let comboBidMultiplier = 1.0;
        let comboCategory = 'standard';
        let comboConfidence = 'insufficient';
        
        const comboAnalysis = comboAnalysisMap.get(keyword.id);
        if (comboAnalysis) {
          comboCategory = comboAnalysis.comboCategory || 'standard';
          comboConfidence = comboAnalysis.confidenceLevel || 'insufficient';
          
          // 只有置信度达到medium以上才应用个性化乘数
          if (comboConfidence !== 'insufficient') {
            comboBidMultiplier = parseFloat(comboAnalysis.suggestedBidMultiplier || '1.000');
            comboTimeMultiplier = parseFloat(comboAnalysis.suggestedTimeMultiplier || '1.000');
            
            // v183: 检查当前时段是否在该投放词的最佳/最差时间窗口内
            const bestWindows: any[] = comboAnalysis.bestTimeWindows || [];
            const worstWindows: any[] = comboAnalysis.worstTimeWindows || [];
            
            const isInBestWindow = bestWindows.some((w: any) => 
              w.dayOfWeek === currentDayOfWeek && currentHour >= w.startHour && currentHour <= w.endHour
            );
            const isInWorstWindow = worstWindows.some((w: any) => 
              w.dayOfWeek === currentDayOfWeek && currentHour >= w.startHour && currentHour <= w.endHour
            );
            
            if (isInBestWindow) {
              // 黄金时段: 额外提升时间乘数 (1.1x ~ 1.3x)
              comboTimeMultiplier = Math.min(comboTimeMultiplier * 1.15, 1.30);
            } else if (isInWorstWindow) {
              // 铅石时段: 降低时间乘数 (0.7x ~ 0.9x)
              comboTimeMultiplier = Math.max(comboTimeMultiplier * 0.85, 0.70);
            }
          }
        }
        
        // v183: 统一资源分配公式
        // 最终乘数 = 广告活动分时乘数 × 投放词个性化竞价乘数 × 投放词个性化时间乘数
        const finalMultiplier = baseDaypartingMultiplier * comboBidMultiplier * comboTimeMultiplier;
        let adjustedBid = baseBid * finalMultiplier;
        
        // 安全护栏: 单次调整不超过基础出价的40%
        const maxAdjustedBid = baseBid * 1.40;
        const minAdjustedBid = baseBid * 0.60;
        adjustedBid = Math.min(adjustedBid, maxAdjustedBid);
        adjustedBid = Math.max(adjustedBid, minAdjustedBid);
        
        // 绝对红线: 不超过最高出价限制
        adjustedBid = Math.min(adjustedBid, maxBidLimit);
        adjustedBid = Math.max(adjustedBid, 0.02);
        adjustedBid = Math.round(adjustedBid * 100) / 100;
        
        const reasonParts: string[] = [];
        reasonParts.push(`分时${baseDaypartingMultiplier.toFixed(2)}x`);
        if (comboBidMultiplier !== 1.0) reasonParts.push(`投放词${comboBidMultiplier.toFixed(3)}x`);
        if (comboTimeMultiplier !== 1.0) reasonParts.push(`时段${comboTimeMultiplier.toFixed(3)}x`);
        if (comboCategory !== 'standard') reasonParts.push(`[${comboCategory}]`);
        
        const adjustment: any = {
          accountId: config.accountId,
          localCampaignId: campaignLocalId,
          amazonCampaignId: campaignAmazonId,
          campaignName: campaign.campaignName,
          keywordId: keyword.id,
          keywordText: keyword.keywordText,
          hour: currentHour,
          dayOfWeek: currentDayOfWeek,
          baseBid,
          bidMultiplier: finalMultiplier,
          baseDaypartingMultiplier,
          comboBidMultiplier,
          comboTimeMultiplier,
          comboCategory,
          comboConfidence,
          adjustedBid,
          currentBid: baseBid,
          newBid: adjustedBid,
          reason: `v183分时竞价: ${currentHour}:00 ${reasonParts.join(' × ')} = ${finalMultiplier.toFixed(3)}x, $${baseBid.toFixed(2)} → $${adjustedBid.toFixed(2)}`,
          apiSyncStatus: dryRun ? 'pending' : 'pending',
        };
        
        // v231: 出价不变时跳过日志记录，避免生成大量无效pending日志
        if (Math.abs(adjustedBid - baseBid) <= 0.01) {
          continue; // 跳过出价未变化的关键词
        }
        
        details.push(adjustment);
        
        if (!dryRun) {
          try {
            const syncResult = await amazonApiHelper.syncBidAdjustmentsToAmazon(
              config.accountId,
              [{
                keywordId: keyword.id,
                newBid: adjustedBid,
                localCampaignId: campaignLocalId,
                amazonCampaignId: campaignAmazonId,
                reason: `v183分时竞价: ${reasonParts.join(' × ')}`,
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
            log.error(`[DaypartingOptimization] API同步失败 (kw ${keyword.keywordText}):`, apiError.message);
          }
        }
      }
    } catch (error: any) {
      details.push({
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
        campaignName: campaign.campaignName,
        error: error.message,
      });
    }
  }
  
  return { executed: true, adjustmentsCount, details };
}

/**
 * v179: 执行分时预算优化
 * 根据星期几的表现数据，动态调整广告活动的每日预算
 * 高投产的星期几增加预算，低投产的星期几减少预算
 */
async function executeDaypartingBudgetOptimization(
  config: OptimizationTargetConfig,
  campaigns: any[],
  dryRun: boolean
): Promise<{ executed: boolean; adjustmentsCount: number; details: any[] }> {
  const details: any[] = [];
  let adjustmentsCount = 0;
  
  // 获取当前星期几（站点本地时间）
  const marketplace = config.marketplace || 'US';
  const now = new Date();
  const currentDayOfWeek = getLocalDayOfWeek(now, marketplace);
  
  for (const campaign of campaigns) {
    const campaignLocalId = getCampaignLocalId(campaign);
    const campaignAmazonId = getCampaignAmazonId(campaign);
    try {
      // 获取分时策略
      let strategy = await daypartingService.getDaypartingStrategyByCampaignId(campaignAmazonId);
      if (!strategy || strategy.daypartingStatus !== 'active') continue;
      
      // 获取今天的预算规则
      const budgetRules = await daypartingService.getBudgetRules(strategy.id);
      const todayRule = budgetRules.find((r: any) => r.dayOfWeek === currentDayOfWeek);
      
      if (!todayRule) continue;
      
      let budgetMultiplier = parseFloat(todayRule.budgetMultiplier || '1.00');
      
      // v183.1: 叠加多维度组合分析的Campaign级别预算乘数
      let comboBudgetMultiplier = 1.0;
      try {
        const dbConn = await getDb();
        if (!dbConn) throw new Error('Database not available');
        comboBudgetMultiplier = await multiDimComboAnalyzer.getCampaignBudgetMultiplier(
          dbConn, config.accountId, campaignLocalId
        );
        if (Math.abs(comboBudgetMultiplier - 1.0) > 0.001) {
          log.debug(`[DaypartingBudget] v183.1: Campaign ${campaign.campaignName} 组合分析预算乘数: ${comboBudgetMultiplier.toFixed(3)}`);
          // 叠加乘数: 分时预算乘数 × 组合分析预算乘数
          budgetMultiplier = budgetMultiplier * comboBudgetMultiplier;
          // 安全护栏: 最终乘数限制在 0.80 ~ 1.30 之间
          budgetMultiplier = Math.max(0.80, Math.min(1.30, budgetMultiplier));
        }
      } catch (comboErr: any) {
        log.warn(`[DaypartingBudget] v183.1: 获取组合分析预算乘数失败: ${comboErr.message}`);
      }
      
      // 如果倍数接近1.0，跳过调整
      if (Math.abs(budgetMultiplier - 1.0) < 0.05) continue;
      
      const currentBudget = parseFloat(campaign.dailyBudget || '0');
      if (currentBudget <= 0) continue;
      
      // 计算基础预算（如果之前已经调整过，需要还原到基础值）
      // 策略：使用campaign的原始预算作为基础，乘以今天的倍数
      const baseBudget = parseFloat((campaign as any).originalDailyBudget || campaign.dailyBudget || '0');
      const adjustedBudget = Math.round(baseBudget * budgetMultiplier * 100) / 100;
      
      const adjustment: any = {
        accountId: config.accountId,
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
        campaignName: campaign.campaignName,
        dayOfWeek: currentDayOfWeek,
        budgetMultiplier,
        baseBudget,
        currentBudget,
        adjustedBudget,
        changeAmount: adjustedBudget - currentBudget,
        changePercent: currentBudget > 0 ? ((adjustedBudget - currentBudget) / currentBudget * 100).toFixed(2) : '0',
        comboBudgetMultiplier,
        reason: `分时预算: 星期${['\u65e5','\u4e00','\u4e8c','\u4e09','\u56db','\u4e94','\u516d'][currentDayOfWeek]} 倍数${budgetMultiplier.toFixed(2)}x${comboBudgetMultiplier !== 1.0 ? ` (含组合分析${comboBudgetMultiplier.toFixed(3)}x)` : ''}, $${currentBudget.toFixed(2)} \u2192 $${adjustedBudget.toFixed(2)}`,
        apiSyncStatus: 'pending',
      };
      
      details.push(adjustment);
      
      // 实际执行预算调整
      if (!dryRun && Math.abs(adjustedBudget - currentBudget) > 0.50) {
        try {
          const amazonCampaignId = campaignAmazonId;
          const budgetSyncResult = await amazonApiHelper.syncBudgetAdjustmentToAmazon(
            config.accountId,
            amazonCampaignId,
            adjustedBudget,
            `v179分时预算: 星期${currentDayOfWeek} 倍数${budgetMultiplier}x`
          );
          
          if (budgetSyncResult) {
            await db.updateCampaign(campaignLocalId, {
              dailyBudget: adjustedBudget.toFixed(2),
              lastOptimizedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
            } as any);
            adjustmentsCount++;
            adjustment.apiSyncStatus = 'synced';
            
            // 记录执行日志
            try {
              await daypartingService.logStrategyExecution({
                strategyId: strategy.id,
                executionType: 'budget_adjustment',
                dpTargetType: 'campaign',
                dpTargetId: campaignLocalId,
                dpTargetName: campaign.campaignName,
                previousValue: currentBudget.toFixed(2),
                newValue: adjustedBudget.toFixed(2),
                multiplierApplied: budgetMultiplier.toFixed(2),
                triggerDayOfWeek: currentDayOfWeek,
                triggerHour: getLocalHour(now, marketplace),
                dpExecStatus: 'success',
              });
            } catch (logErr: any) {
              log.warn(`[DaypartingBudget] 日志记录失败: ${logErr.message}`);
            }
            
            log.debug(`[DaypartingBudget] v179: ${campaign.campaignName} 预算调整 $${currentBudget.toFixed(2)} \u2192 $${adjustedBudget.toFixed(2)} (星期${currentDayOfWeek}, 倍数${budgetMultiplier}x)`);
          } else {
            adjustment.apiSyncStatus = 'failed';
            log.warn(`[DaypartingBudget] v179: API同步失败 (Campaign ${campaign.campaignName})`);
          }
        } catch (apiError: any) {
          adjustment.apiSyncStatus = 'failed';
          adjustment.apiSyncDetail = JSON.stringify({ error: apiError.message });
          log.error(`[DaypartingBudget] v179: API同步异常 (Campaign ${campaign.campaignName}):`, apiError.message);
        }
      }
    } catch (error: any) {
      details.push({
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
        campaignName: campaign.campaignName,
        error: error.message,
      });
    }
  }
  
  // 更新策略的lastAppliedAt
  if (adjustmentsCount > 0) {
    try {
      const strategies = await daypartingService.getDaypartingStrategies(config.accountId);
      for (const s of strategies) {
        if (s.daypartingStatus === 'active') {
          await daypartingService.updateDaypartingStrategy(s.id, {
            lastAppliedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
          });
        }
      }
    } catch (updateErr: any) {
      log.warn(`[DaypartingBudget] 更新lastAppliedAt失败: ${updateErr.message}`);
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
    const campaignLocalId = getCampaignLocalId(campaign);
    const campaignAmazonId = getCampaignAmazonId(campaign);
    try {
      // 获取搜索词数据
      const searchTerms = await db.getSearchTermsByCampaignId(campaignAmazonId as any);
      
      // v191: 使用智能投放决策引擎替代旧的classifySearchTerms
      // 获取campaign的定向类型（auto/manual）
      const campaignTargetingType = (campaign as any).targetingType || 
        ((campaign as any).campaignType === 'sp_auto' ? 'auto' : 'manual');
      const targetAcos = config.targetAcos || 30; // 默认30%
      
      // v191: 将搜索词数据转换为智能决策引擎所需的格式
      const searchTermPerformanceList: SearchTermPerformance[] = searchTerms.map((st: any) => ({
        searchTerm: st.searchTerm,
        clicks: Number(st.searchTermClicks || 0),
        impressions: Number(st.searchTermImpressions || 0),
        orders: Number(st.searchTermOrders || 0),
        spend: Number(st.searchTermSpend || 0),
        sales: Number(st.searchTermSales || 0),
        campaignTargetingType: campaignTargetingType as 'auto' | 'manual',
        targetAcos: targetAcos,
      }));
      
      log.debug(`[SearchTermAnalysis] v191: Campaign "${campaign.campaignName}" (${campaignTargetingType}): ${searchTermPerformanceList.length}个搜索词待分析`);
      
      // v122h: 获取品牌词用于保护
      const account = await db.getAdAccountById(config.accountId);
      const brandTerms = account?.storeName ? [account.storeName] : [];
      
      // v191: 对每个搜索词调用智能决策引擎
      for (const stPerf of searchTermPerformanceList) {
        const decision = decideTargeting(stPerf);
        
        // SKIP和MONITOR不需要操作
        if (decision.action === 'SKIP' || decision.action === 'MONITOR') {
          continue;
        }
        
        // ===== 否定关键词处理 =====
        if (decision.action === 'CREATE_NEGATIVE_KEYWORD') {
          // v122h: 品牌词保护 - 不否定含有品牌词的搜索词
          if (brandTerms.length > 0 && isProtectedKeyword(stPerf.searchTerm, brandTerms)) {
            details.push({
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              campaignName: campaign.campaignName,
              searchTerm: stPerf.searchTerm,
              action: 'brand_protect_skip',
              reason: `[品牌词保护] 搜索词"${stPerf.searchTerm}"含有品牌词，跳过否定`,
            });
            continue;
          }
          
          // v122h: 探索期保护 - 检查对应的投放词是否在探索期内
          const matchingKeywords = await db.getKeywordsByCampaignId(campaignAmazonId);
          const matchingKw = matchingKeywords.find((kw: any) => 
            kw.keywordText?.toLowerCase() === stPerf.searchTerm.toLowerCase()
          );
          if (matchingKw?.createdAt) {
            const kwCreatedAt = new Date(matchingKw.createdAt);
            if (isNewKeyword(kwCreatedAt, matchingKw.clicks || 0, matchingKw.impressions || 0, 7)) {
              details.push({
                localCampaignId: campaignLocalId,
                amazonCampaignId: campaignAmazonId,
                campaignName: campaign.campaignName,
                searchTerm: stPerf.searchTerm,
                action: 'exploration_protect_skip',
                reason: `[探索期保护] 对应投放词在探索期内，跳过否定，给予充分的数据积累时间`,
              });
              continue;
            }
          }
          
          // v204: 否定词预验证 — 在入队前清洗特殊字符并检查Amazon限制
          let negMatchType = decision.negativeMatchType === 'negative_exact' ? 'negative_exact' : 'negative_phrase';
          const negValidation = sanitizeAndValidateKeyword(decision.targetValue, negMatchType as any);
          let cleanedNegText = negValidation.sanitizedText || decision.targetValue;
          
          if (!negValidation.isValid) {
            // v204: 如果negative_phrase超过4个词，自动升级为negative_exact（最多10个词）
            if (negMatchType === 'negative_phrase' && negValidation.reasonCode === 'EXCEEDS_MAX_WORDS_NEG_PHRASE') {
              const exactValidation = sanitizeAndValidateKeyword(decision.targetValue, 'negative_exact');
              if (exactValidation.isValid) {
                negMatchType = 'negative_exact';
                cleanedNegText = exactValidation.sanitizedText;
                log.debug(`[SearchTermAnalysis] v204: 否定短语"${decision.targetValue}"超过4词限制，自动升级为negative_exact`);
              } else {
                log.warn(`[SearchTermAnalysis] v204: 否定词预验证失败(升级后仍无效): "${decision.targetValue}" → ${exactValidation.reasonMessage}`);
                details.push({
                  localCampaignId: campaignLocalId,
                  amazonCampaignId: campaignAmazonId,
                  campaignName: campaign.campaignName,
                  searchTerm: decision.targetValue,
                  action: 'negative_validation_failed',
                  reason: `v204预验证失败: ${exactValidation.reasonMessage}`,
                });
                continue;
              }
            } else {
              log.warn(`[SearchTermAnalysis] v204: 否定词预验证失败: "${decision.targetValue}" → ${negValidation.reasonMessage}`);
              details.push({
                localCampaignId: campaignLocalId,
                amazonCampaignId: campaignAmazonId,
                campaignName: campaign.campaignName,
                searchTerm: decision.targetValue,
                action: 'negative_validation_failed',
                reason: `v204预验证失败: ${negValidation.reasonMessage}`,
              });
              continue;
            }
          }
          
          // v170: 否定关键词去重检查
          let negativeAlreadyExists = false;
          if (!dryRun) {
            const dbInstance = await db.getDb();
            if (dbInstance) {
              const { negativeKeywords: negKwTable } = await import('../drizzle/schema');
              const { eq: eqOp, and: andOp } = await import('drizzle-orm');
              const existingNeg = await dbInstance.select({ id: negKwTable.id, amazonNegativeKeywordId: negKwTable.amazonNegativeKeywordId })
                .from(negKwTable)
                .where(andOp(
                  eqOp(negKwTable.campaignId, campaignAmazonId as any),
                  eqOp(negKwTable.negativeText, cleanedNegText)
                ))
                .limit(1);
              if (existingNeg.length > 0) {
                negativeAlreadyExists = true;
                log.info(`[SearchTermAnalysis] v170: 否定关键词已存在，跳过: "${cleanedNegText}" campaignId=${campaign.campaignId}`);
              }
            }
          }

          const negativeKeyword: any = {
            accountId: config.accountId,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            campaignName: campaign.campaignName,
            searchTerm: cleanedNegText,
            matchType: negMatchType,
            action: 'add_negative',
            reason: `v204智能否定: ${decision.reason}`,
            apiSyncStatus: negativeAlreadyExists ? 'already_exists' : 'pending',
            confidence: decision.confidence,
            dataMaturityLevel: decision.dataMaturityLevel,
          };
          
          details.push(negativeKeyword);
          
          if (!dryRun && !negativeAlreadyExists) {
            const matchType = negMatchType === 'negative_exact' ? 'exact' : 'phrase';
            negativeKeyword._pendingDbInsert = {
              accountId: campaign.accountId || 0,
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              negativeLevel: 'campaign',
              negativeType: 'keyword',
              negativeText: cleanedNegText,
              negativeMatchType: negMatchType,
              negativeSource: 'auto_optimization',
              createdAt: new Date().toISOString(),
            };
            negativeKeywordsAdded++;
          }
        }
        
        // ===== 正面关键词处理 =====
        else if (decision.action === 'CREATE_KEYWORD') {
          // v191: 自动广告活动不能添加正面关键词（已在算法层拦截，这里双重保险）
          if (!canAddPositiveKeyword(campaignTargetingType)) {
            log.info(`[SearchTermAnalysis] v191: 自动广告活动不能添加正面关键词，跳过: "${decision.targetValue}"`);
            continue;
          }
          
          // v194: ASIN格式的搜索词不应该作为keyword创建，重定向到product target
          if (isAsinSearchTerm(decision.targetValue)) {
            log.debug(`[SearchTermAnalysis] v194: ASIN搜索词"${decision.targetValue}"重定向为product target`);
            const ptBid = decision.suggestedBid || 0.50;
            details.push({
              accountId: config.accountId,
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              campaignName: campaign.campaignName,
              searchTerm: decision.targetValue,
              matchType: 'product_target_exact',
              action: 'add_product_target',
              reason: `v194: ASIN搜索词自动重定向为product target: ${decision.reason}`,
              suggestedBid: ptBid,
              apiSyncStatus: 'pending',
              confidence: decision.confidence,
              dataMaturityLevel: decision.dataMaturityLevel,
              valueLevel: decision.valueLevel,
            });
            continue;
          }
          
          // v204: 正面关键词预验证 — 在入队前清洗特殊字符并检查Amazon限制
          const posValidation = sanitizeAndValidateKeyword(decision.targetValue, 'positive');
          if (!posValidation.isValid) {
            log.warn(`[SearchTermAnalysis] v204: 正面关键词预验证失败: "${decision.targetValue}" → ${posValidation.reasonMessage}`);
            details.push({
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
              campaignName: campaign.campaignName,
              searchTerm: decision.targetValue,
              action: 'keyword_validation_failed',
              reason: `v204预验证失败: ${posValidation.reasonMessage}`,
            });
            continue;
          }
          const cleanedPosText = posValidation.sanitizedText;
          
          // v191: 使用算法决定的匹配方式和出价
          const matchType = decision.matchType || 'phrase';
          const bid = decision.suggestedBid || 0.50;
          
          const newKeyword: any = {
            accountId: config.accountId,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            campaignName: campaign.campaignName,
            searchTerm: cleanedPosText,
            matchType: matchType,
            action: 'add_keyword',
            reason: `v204智能投放: ${decision.reason}`,
            suggestedBid: bid,
            apiSyncStatus: dryRun ? 'pending' : 'pending',
            confidence: decision.confidence,
            dataMaturityLevel: decision.dataMaturityLevel,
            valueLevel: decision.valueLevel,
          };
          
          details.push(newKeyword);
          
          if (!dryRun) {
            const dbInstance = await db.getDb();
            if (dbInstance) {
              const adGroups = await db.getAdGroupsByCampaignId(campaignAmazonId);
              if (adGroups.length > 0) {
                const adGroup = adGroups[0];
                const amazonAdGroupId = Number(adGroup.adGroupId || 0);
                // v201: 直接使用字符串避免大数字精度丢失
                const amazonCampaignId = campaignAmazonId;
                
                // v194: 检查广告组是否已有product targets
                try {
                  const hasProductTargets = await adGroupHasProductTargets(adGroup.id);
                  if (hasProductTargets) {
                    log.info(`[SearchTermAnalysis] v194: 广告组已有product targets，不能添加keyword，跳过: "${decision.targetValue}"`);
                    newKeyword.apiSyncStatus = 'skipped_pt_adgroup';
                    continue;
                  }
                } catch (ptCheckErr: any) {
                  log.warn(`[SearchTermAnalysis] v194: 检查product targets失败: ${ptCheckErr.message}`);
                }
                
                // v168: 增强去重检查
                const { keywords } = await import('../drizzle/schema');
                const { eq: eqOp, and: andOp } = await import('drizzle-orm');
                const existingKeywords = await dbInstance.select({ id: keywords.id, keywordId: keywords.keywordId, matchType: keywords.matchType })
                  .from(keywords)
                  .where(andOp(
                    eqOp(keywords.adGroupId, adGroup.id),
                    eqOp(keywords.keywordText, decision.targetValue)
                  ))
                  .limit(10);
                
                if (existingKeywords.length > 0) {
                  // v139: 清理重复记录
                  if (existingKeywords.length > 1) {
                    const withId = existingKeywords.filter(k => k.keywordId !== null);
                    const withoutId = existingKeywords.filter(k => k.keywordId === null);
                    const toDelete = withId.length > 0 ? withoutId : withoutId.slice(1);
                    for (const dup of toDelete) {
                      try {
                        await dbInstance.delete(keywords).where(eqOp(keywords.id, dup.id));
                        log.debug(`[SearchTermAnalysis] 清理重复关键词: id=${dup.id} "${decision.targetValue}"`);
                      } catch (delErr: any) {
                        log.warn(`[SearchTermAnalysis] 清理重复关键词失败: id=${dup.id}: ${delErr.message}`);
                      }
                    }
                  }
                  const existingMatchTypes = existingKeywords.map(k => k.matchType || 'unknown').join(',');
                  newKeyword.apiSyncStatus = 'already_exists';
                  newKeyword.apiSyncDetail = JSON.stringify({ existingId: existingKeywords[0].id, existingKeywordId: existingKeywords[0].keywordId, existingMatchTypes });
                  log.info(`[SearchTermAnalysis] v168: 关键词已存在，跳过: "${decision.targetValue}" (请求=${matchType}, 已存在=${existingMatchTypes})`);
                } else {
                  // v191: 使用算法建议的出价而非固定$0.50
                  const insertResult = await dbInstance.insert(keywords).values({
                    adGroupId: adGroup.id,
                    keywordText: decision.targetValue,
                    matchType: matchType as any,
                    bid: String(bid),
                    keywordStatus: 'enabled',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  });
                  const localKeywordId = (insertResult as any)[0]?.insertId;
                  
                  if (Number(amazonAdGroupId) > 0 && Number(amazonCampaignId) > 0) {
                    try {
                      const apiResult = await amazonApiHelper.syncNewKeywordsToAmazon(
                        config.accountId,
                        [{
                          localKeywordId: localKeywordId || undefined,
                          adGroupId: amazonAdGroupId,
                          campaignId: amazonCampaignId,
                          keywordText: decision.targetValue,
                          matchType: matchType,
                          bid: bid,
                        }]
                      );
                      if (apiResult.success > 0) {
                        newKeyword.apiSyncStatus = 'synced';
                        log.info(`[SearchTermAnalysis] v191: 新关键词[${matchType}]已同步: "${decision.targetValue}" bid=$${bid}`);
                      } else {
                        newKeyword.apiSyncStatus = 'failed';
                        newKeyword.apiSyncDetail = JSON.stringify({ errors: apiResult.errors });
                        log.error(`[SearchTermAnalysis] 新关键词同步失败: "${decision.targetValue}" - ${apiResult.errors.join('; ')}`);
                      }
                    } catch (apiError: any) {
                      newKeyword.apiSyncStatus = 'failed';
                      newKeyword.apiSyncDetail = JSON.stringify({ error: apiError.message });
                      log.error(`[SearchTermAnalysis] 新关键词API异常: "${decision.targetValue}" -`, apiError.message);
                    }
                  } else {
                    log.warn(`[SearchTermAnalysis] 缺少Amazon ID，无法同步: adGroupId=${amazonAdGroupId}, campaignId=${amazonCampaignId}`);
                  }
                }
              }
            }
            if (newKeyword.apiSyncStatus !== 'already_exists') {
              newKeywordsAdded++;
            }
          }
        }
        
        // ===== ASIN商品定向处理 =====
        else if (decision.action === 'CREATE_PRODUCT_TARGET') {
          // v191: ASIN商品定向投放 - 精确定向或扩展定向
          const ptType = decision.productTargetingType || 'exact';
          const bid = decision.suggestedBid || 0.50;
          
          const newTarget: any = {
            accountId: config.accountId,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
            campaignName: campaign.campaignName,
            searchTerm: decision.targetValue,
            matchType: `product_target_${ptType}`,
            action: 'add_product_target',
            reason: `v191智能ASIN定向: ${decision.reason}`,
            suggestedBid: bid,
            apiSyncStatus: dryRun ? 'pending' : 'pending',
            confidence: decision.confidence,
            dataMaturityLevel: decision.dataMaturityLevel,
            valueLevel: decision.valueLevel,
          };
          
          details.push(newTarget);
          // v191: ASIN商品定向的Amazon API同步将在后续版本实现
          // 当前先记录决策，不执行API调用
          log.debug(`[SearchTermAnalysis] v191: ASIN定向决策[${ptType}]: "${decision.targetValue}" bid=$${bid} (${decision.reason})`);
        }
      }
      // v134: 同步否定关键词到 Amazon API，并记录同步状态
      if (!dryRun) {
        const negativeDetails = details.filter(d => d.action === 'add_negative' && d.localCampaignId === campaignLocalId);
        if (negativeDetails.length > 0) {
          try {
            // v201: 直接使用字符串避免大数字精度丢失
            const amazonCampaignId = campaignAmazonId;
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
            log.info(`[SearchTermAnalysis] Amazon API同步: ${negativeDetails.length}个否定词, 状态=${negSyncStatus} (Campaign ${campaign.campaignName})`);
            
            // v165: API成功后才写入本地DB（先API后DB原则）
            if (negSyncStatus === 'synced' || negSyncStatus === 'partial') {
              const dbInstance = await db.getDb();
              if (dbInstance) {
                const { negativeKeywords } = await import('../drizzle/schema');
                for (const d of negativeDetails) {
                  if (d._pendingDbInsert && d.apiSyncStatus !== 'failed') {
                    try {
                      await dbInstance.insert(negativeKeywords).values(d._pendingDbInsert);
                      
                      // v195: 回写amazon_negative_keyword_id
                      const mapKey = `campaign:${amazonCampaignId}:${d.searchTerm.toLowerCase()}`;
                      const amazonNegId = negSyncResult.keywordIdMap?.get(mapKey);
                      if (amazonNegId) {
                        await dbInstance.execute(sql`
                          UPDATE negative_keywords 
                          SET amazon_negative_keyword_id = ${amazonNegId}
                          WHERE negativeText = ${d.searchTerm}
                            AND campaignId = ${campaign.campaignId}
                            AND amazon_negative_keyword_id IS NULL
                          LIMIT 1
                        `);
                        log.info(`[SearchTermAnalysis] v195: 否词ID回写成功: "${d.searchTerm}" -> ${amazonNegId}`);
                      }
                      
                      log.info(`[SearchTermAnalysis] v165: 否词DB写入成功: "${d.searchTerm}"`);
                    } catch (dbErr: any) {
                      log.error(`[SearchTermAnalysis] v165: 否词DB写入失败: "${d.searchTerm}" - ${dbErr.message}`);
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
                      localCampaignId: campaignLocalId,
                      amazonCampaignId: campaignAmazonId,
                    }))
                  );
                }
              } catch (verifyErr: any) {
                log.warn(`[SearchTermAnalysis] v166: 注册验证任务失败(不影响主流程): ${verifyErr.message}`);
              }
            } else {
              log.warn(`[SearchTermAnalysis] v165: API同步失败，跳过本地DB写入 (Campaign ${campaign.campaignName})`);
            }
          } catch (apiError: any) {
            for (const d of negativeDetails) {
              d.apiSyncStatus = 'failed';
              d.apiSyncDetail = JSON.stringify({ error: apiError.message });
            }
            log.error(`[SearchTermAnalysis] Amazon API同步失败，未写入本地DB (Campaign ${campaign.campaignName}):`, apiError.message);
          }
        }
      }
    } catch (error: any) {
      details.push({
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
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
        log.debug(`[BudgetAllocation] v163: 渐进式预算 - Campaign ${campaign.campaignName}: $${suggestion.currentBudget.toFixed(0)}→$${finalBudget.toFixed(0)} (算法目标$${suggestion.suggestedBudget.toFixed(0)}, 订单保护=${gradualResult.orderProtectionActive})`);
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
          const amazonCampaignId = getCampaignAmazonId(campaign);
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
              log.warn(`[BudgetAllocation] v166: 注册验证任务失败(不影响主流程): ${verifyErr.message}`);
            }
          } else {
            // API返回false，不更新本地DB
            adjustment.apiSyncStatus = 'failed';
            log.warn(`[BudgetAllocation] v148: API同步失败，跳过DB更新 (Campaign ${campaign.campaignName})`);
          }
        } catch (apiError: any) {
          // API异常，不更新本地DB，保持数据一致性
          adjustment.apiSyncStatus = 'failed';
          adjustment.apiSyncDetail = JSON.stringify({ error: apiError.message });
          log.error(`[BudgetAllocation] v148: API同步失败，跳过DB更新 (Campaign ${campaign.campaignName}):`, apiError.message);
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
  // v170: 优先使用策略模板名称来决定暂停阈值
  const goal = config.strategyTemplateId || config.optimizationGoal || 'balanced';
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
    const campaignLocalId = getCampaignLocalId(campaign);
    const campaignAmazonId = getCampaignAmazonId(campaign);
    try {
      // v163: 获取campaign级别的90天时间衰减加权数据，用于修正投放词状态决策
      let campaignTWMetrics: timeDecayService.TimeWeightedMetrics | null = null;
      try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 90);
        const rawDailyData = await db.getDailyPerformanceByDateRange(config.accountId, startDate, endDate, campaignAmazonId);
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
        log.warn(`[KeywordStatus] v163: Campaign ${campaignLocalId} 时间衰减数据获取失败: ${e.message}`);
      }
      
      // 获取广告活动下的所有关键词
      const keywords = await db.getKeywordsByCampaignId(campaignAmazonId);
      
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
                localCampaignId: campaignLocalId,
                amazonCampaignId: campaignAmazonId,
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
                localCampaignId: campaignLocalId,
                amazonCampaignId: campaignAmazonId,
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
              localCampaignId: campaignLocalId,
              amazonCampaignId: campaignAmazonId,
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
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
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
                  localCampaignId: campaignLocalId,
                  amazonCampaignId: campaignAmazonId,
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
                } catch (ve: any) { log.warn(`[KeywordStatusChange] v166: 验证任务注册失败: ${ve.message}`); }
              } else {
                // API失败，不更新本地DB
                action.apiSyncStatus = 'failed';
                if (syncResult.errors.length > 0) {
                  action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
                }
                log.warn(`[KeywordStatusChange] v148: API同步失败，跳过DB更新 (暂停 ${keyword.keywordText})`);
              }
            } catch (apiError: any) {
              action.apiSyncStatus = 'failed';
              action.apiSyncDetail = JSON.stringify({ error: apiError.message });
              log.error(`[KeywordStatusChange] v148: API同步失败，跳过DB更新 (暂停 ${keyword.keywordText}):`, apiError.message);
            }
          }
        } else if (shouldEnable) {
          const action: any = {
            accountId: config.accountId,
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
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
                  localCampaignId: campaignLocalId,
                  amazonCampaignId: campaignAmazonId,
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
                } catch (ve: any) { log.warn(`[KeywordStatusChange] v166: 验证任务注册失败: ${ve.message}`); }
              } else {
                // API失败，不更新本地DB
                action.apiSyncStatus = 'failed';
                if (syncResult.errors.length > 0) {
                  action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
                }
                log.warn(`[KeywordStatusChange] v148: API同步失败，跳过DB更新 (启用 ${keyword.keywordText})`);
              }
            } catch (apiError: any) {
              action.apiSyncStatus = 'failed';
              action.apiSyncDetail = JSON.stringify({ error: apiError.message });
              log.error(`[KeywordStatusChange] v148: API同步失败，跳过DB更新 (启用 ${keyword.keywordText}):`, apiError.message);
            }
          }
        }
      }
    } catch (error: any) {
      details.push({
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
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
  
  // v170: 优先使用策略模板名称来决定广告活动暂停阈值
  const goal = config.strategyTemplateId || config.optimizationGoal || 'balanced';
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
    const campaignLocalId = getCampaignLocalId(campaign);
    const campaignAmazonId = getCampaignAmazonId(campaign);
    try {
      // v163: 获取campaign级别时间衰减加权数据
      let campaignTWMetrics: timeDecayService.TimeWeightedMetrics | null = null;
      try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 90);
        const rawDailyData = await db.getDailyPerformanceByDateRange(config.accountId, startDate, endDate, campaignAmazonId);
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
        log.warn(`[CampaignStatus] v163: Campaign ${campaignLocalId} 时间衰减数据获取失败: ${e.message}`);
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
          localCampaignId: campaignLocalId,
          amazonCampaignId: campaignAmazonId,
          campaignName: campaign.campaignName,
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
                localCampaignId: campaignLocalId,
                amazonCampaignId: campaignAmazonId,
                newStatus: 'paused',
                campaignName: campaign.campaignName || '',
                reason: pauseReason,
              }]
            );
            if (syncResult.success > 0) {
              await db.updateCampaign(campaignLocalId, { campaignStatus: 'paused' });
              pausedCount++;
              action.apiSyncStatus = 'synced';
            } else {
              action.apiSyncStatus = 'failed';
              if (syncResult.errors.length > 0) {
                action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
              }
              log.warn(`[CampaignStatusChange] v148: API同步失败，跳过DB更新 (暂停 ${campaign.campaignName})`);
            }
          } catch (apiError: any) {
            action.apiSyncStatus = 'failed';
            action.apiSyncDetail = JSON.stringify({ error: apiError.message });
            log.error(`[CampaignStatusChange] v148: API同步失败，跳过DB更新 (暂停 ${campaign.campaignName}):`, apiError.message);
          }
        }
      } else if (shouldEnable) {
        const action: any = {
          accountId: config.accountId,
          entityType: 'campaign',
          localCampaignId: campaignLocalId,
          amazonCampaignId: campaignAmazonId,
          campaignName: campaign.campaignName,
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
                localCampaignId: campaignLocalId,
                amazonCampaignId: campaignAmazonId,
                newStatus: 'enabled',
                campaignName: campaign.campaignName || '',
                reason: enableReason,
              }]
            );
            if (syncResult.success > 0) {
              await db.updateCampaign(campaignLocalId, { campaignStatus: 'enabled' });
              enabledCount++;
              action.apiSyncStatus = 'synced';
            } else {
              action.apiSyncStatus = 'failed';
              if (syncResult.errors.length > 0) {
                action.apiSyncDetail = JSON.stringify({ errors: syncResult.errors });
              }
              log.warn(`[CampaignStatusChange] v148: API同步失败，跳过DB更新 (启用 ${campaign.campaignName})`);
            }
          } catch (apiError: any) {
            action.apiSyncStatus = 'failed';
            action.apiSyncDetail = JSON.stringify({ error: apiError.message });
            log.error(`[CampaignStatusChange] v148: API同步失败，跳过DB更新 (启用 ${campaign.campaignName}):`, apiError.message);
          }
        }
      }
    } catch (error: any) {
      details.push({
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
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
    const campaignLocalId = getCampaignLocalId(campaign);
    const campaignAmazonId = getCampaignAmazonId(campaign);
    try {
      const adGroups = await db.getAdGroupsByCampaignId(campaignAmazonId);
      
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
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
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
            localCampaignId: campaignLocalId,
            amazonCampaignId: campaignAmazonId,
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
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
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
    const campaignLocalId = getCampaignLocalId(campaign);
    const campaignAmazonId = getCampaignAmazonId(campaign);
    try {
      const proposals: bidCoordinator.BidProposal[] = [];
      
      // 1. 收集出价优化建议
      const bidSuggestions = bidDetails.filter(d => d.localCampaignId === campaignLocalId);
      for (const suggestion of bidSuggestions) {
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
      const placementSuggestions = placementDetails.filter(d => d.localCampaignId === campaignLocalId);
      for (const suggestion of placementSuggestions) {
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
      const daypartingSuggestions = daypartingDetails.filter(d => d.localCampaignId === campaignLocalId);
      for (const suggestion of daypartingSuggestions) {
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
    } catch (error: any) {
      details.push({
        localCampaignId: campaignLocalId,
        amazonCampaignId: campaignAmazonId,
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
      log.debug(`[recordExecutionLog] v140: 出价调整日志: details=${result.bidOptimization.details.length}`);
      
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
            actionType: (detail.newBid ?? 0) > (detail.currentBid ?? 0) ? 'bid_increase' : 'bid_decrease',
            campaignId: detail.localCampaignId,
            campaignName: detail.campaignName,
            actionDetail: JSON.stringify(detail),
            // v175+v230: 防御性校验，避免toFixed对undefined调用崩溃
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
          });
        } catch (insertError: any) {
          log.error(`[recordExecutionLog] 出价日志写入失败: ${insertError.message}`, { keywordId: detail.keywordId, itemSyncStatus });
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
          campaignId: detail.localCampaignId,
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
    
    // v134: 记录预算分配日志（包含API同步状态）
    if (result.budgetAllocation.executed && result.budgetAllocation.adjustmentsCount > 0) {
      for (const detail of result.budgetAllocation.details) {
        await dbInstance.insert(optimizationLogs).values({
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
    
    // v179: 记录分时预算日志
    if (result.daypartingBudgetOptimization?.executed && result.daypartingBudgetOptimization.adjustmentsCount > 0) {
      for (const detail of result.daypartingBudgetOptimization.details) {
        if (detail.error) continue;
        await dbInstance.insert(optimizationLogs).values({
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
    
    // 记录投放词状态变更日志（包含API同步状态）
    if (result.keywordStatusChanges.executed) {
      for (const detail of result.keywordStatusChanges.details) {
        await dbInstance.insert(optimizationLogs).values({
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
    
    // v139: 更新优化目标的 last_optimization_at 时间戳
    try {
      const { performanceGroups } = await import('../drizzle/schema');
      const { eq: eqOp } = await import('drizzle-orm');
      await dbInstance.update(performanceGroups)
        .set({ lastOptimizationAt: new Date() } as any)
        .where(eqOp(performanceGroups.id, result.targetId));
      log.info(`[OptimizationTargetEngine] 已更新 last_optimization_at: targetId=${result.targetId}`);
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
          log.info(`[OptimizationTargetEngine] 已通过mysql2更新 last_optimization_at: targetId=${result.targetId}`);
        }
      } catch (directErr: any) {
        log.error(`[OptimizationTargetEngine] 更新last_optimization_at失败: ${directErr.message}`);
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
  } catch (error: any) {
    log.error(`[OptimizationTargetEngine] 日志写入失败:`, error.message);
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
  log.info(`[OptimizationTargetEngine] 批量执行 ${targets.length} 个优化目标, 模块: ${modulesDesc}`);
  
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
        daypartingBudgetOptimization: { executed: false, adjustmentsCount: 0, details: [] }, // v179
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
    const campaignAmazonId = getCampaignAmazonId(campaign);
    const keywords = await db.getKeywordsByCampaignId(campaignAmazonId);
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
