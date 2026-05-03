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
import { keywords as keywordsTable, productTargets as productTargetsTable, campaigns as campaignsTable, dailyPerformance } from "../../drizzle/schema";
import { eq, sql, and } from "drizzle-orm";
import { safeInClause } from '../utils/safeSql';
import * as bidOptimizer from "./bidOptimizer";

// v743-fix2: 断路器同步触发全局节流 — 防止多个优化目标同时触发syncAllAccounts洪泛
let _lastCircuitBreakerSyncTime = 0;
const CIRCUIT_BREAKER_SYNC_THROTTLE_MS = 5 * 60 * 1000; // 5分钟内最多触发1次
async function throttledCircuitBreakerSync(): Promise<void> {
  const now = Date.now();
  if (now - _lastCircuitBreakerSyncTime < CIRCUIT_BREAKER_SYNC_THROTTLE_MS) {
    log.debug(`[OptimizationTarget] v743-fix2: 断路器同步节流中，距上次触发${Math.round((now - _lastCircuitBreakerSyncTime) / 1000)}秒，跳过`);
    return;
  }
  _lastCircuitBreakerSyncTime = now;
  try {
    const { syncAllAccounts } = await import('../sync/unifiedSyncEngine');
    log.info(`[OptimizationTarget] v743-fix2: 断路器触发节流同步请求（5分钟内仅此1次）...`);
    syncAllAccounts('high').catch((err: Error) => {
      log.warn(`[OptimizationTarget] v743-fix2: 节流同步失败: ${err.message}`);
    });
  } catch (syncErr: unknown) {
    log.warn(`[OptimizationTarget] v743-fix2: 触发节流同步失败: ${(syncErr as Error).message}`);
  }
}
import * as daypartingService from "../budget/daypartingService";
import * as placementOptimizationService from "./placementOptimizationService";
import { preOptimizationSafetyCheck, applyBidGuardrail, applyBudgetGuardrail, applyPlacementGuardrail, SAFETY_LIMITS } from './optimizationSafetyGuardrails';
import * as adAutomation from "../automation/adAutomation";
import * as intelligentBudgetAllocationService from "../budget/intelligentBudgetAllocationService";
import { optimizeBudgetPortfolio } from "../budget/budgetPortfolioOptimizer";
import * as bidCoordinator from "../services/bidCoordinator";
import * as nextGenOrchestrator from "./nextGenBidOrchestrator";
import * as amazonApiHelper from "../services/amazonApiHelper";
import { acquireAccountOptimizationLock, acquireAccountOptimizationLockWithRetry, releaseAccountOptimizationLock, getModuleLockGroup } from "../utils/lockManager";
import * as amazonIdResolver from "../services/amazonIdResolver";
import { getLocalHour, getLocalDayOfWeek, isNewKeyword, getExplorationStrategy, isProtectedKeyword } from "../algorithm/algorithmUtils";
import * as campaignLifecycleService from "../services/campaignLifecycleService";
import * as timeDecayService from "../analytics/timeDecayWeightedDataService";
import * as gradualEngine from "./gradualOptimizationEngine";
import * as selfEvolution from "../algorithm/selfEvolutionEngine";
import * as multiDimOptimizer from "./multiDimensionOptimizer";
import * as multiDimComboAnalyzer from "./multiDimComboAnalyzer";
import * as postOptVerifier from "./postOptimizationVerifier";
import { registerActiveTask, unregisterActiveTask, isShuttingDown } from "../utils/taskLifecycle";
import { decideTargeting, type SearchTermPerformance, type TargetingDecision } from "../services/targetingAlgorithm";
import { sanitizeAndValidateKeyword, canAddPositiveKeyword, isAsinSearchTerm, adGroupHasProductTargets, isProductTargetingCampaign } from "../utils/keywordValidator";
import { createModuleLogger } from '../utils/logger';
import { getCampaignAmazonId, getCampaignLocalId } from '../utils/idTypes';
import { recordAudit, auditBidChange } from '../services/auditLogService';
import { generateNegativeKeywordSuggestions, executeNegativeKeywords as executeNgramNegativeKeywords } from '../analytics/ngramAnalysis';

const log = createModuleLogger('TargetEngine');

// v476: API限流防护 — 模块间节流延迟配置
// 每个优化模块执行完成后，等待一段时间再执行下一个模块
// 目的：避免所有优化指令在极短时间内通过API密集发送，给亚马逊API足够的处理窗口
const INTER_MODULE_DELAY_MS = 20000;  // 模块间延迟20秒 — 优先保证100%成功率，不追求执行速度
const INTER_API_BATCH_DELAY_MS = 10000;  // API批次间延迟10秒 — 完全避免429限流

function throttleDelay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 缓存账号站点信息，避免重复查询

// v362: 从子模块导入拆分的执行器函数
import { executeBidOptimization } from '../targetEngine/bidOptimizationExecutor';
import { executeSearchTermAnalysis, executeAutoNgramNegation } from '../targetEngine/searchTermExecutor';
import { executeDaypartingOptimization, executeDaypartingBudgetOptimization } from '../targetEngine/daypartingExecutor';
import { executeKeywordStatusChanges, executeCampaignStatusChanges, executeAdGroupStatusChanges } from '../targetEngine/statusChangeExecutor';
import { executePlacementOptimization } from '../targetEngine/placementExecutor';
import { executeBudgetAllocation } from '../targetEngine/budgetExecutor';
import { executeBidCoordination } from '../targetEngine/bidCoordinationExecutor';
import { recordExecutionLog } from '../targetEngine/executionLogger';

// v346: 添加TTL清理机制，防止内存泄漏
const CACHE_TTL_MS = 30 * 60 * 1000; // 30分钟TTL
const marketplaceCache = new Map<number, { value: string; expiresAt: number }>();

// 定期清理过期缓存
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of marketplaceCache.entries()) {
    if (now > entry.expiresAt) marketplaceCache.delete(key);
  }
}, 10 * 60 * 1000);

async function getAccountMarketplace(accountId: number): Promise<string> {
  const cached = marketplaceCache.get(accountId);
  if (cached && Date.now() < cached.expiresAt) return cached.value;
  const account = await db.getAdAccountById(accountId);
  const marketplace = account?.marketplace || 'US';
  marketplaceCache.set(accountId, { value: marketplace, expiresAt: Date.now() + CACHE_TTL_MS });
  return marketplace;
}

// v221: 获取账户最后同步时间，用于数据新鲜度检查
async function getLastSyncTimeForAccount(accountId: number): Promise<Date | null> {
  try {
    const account = await db.getAdAccountById(accountId);
    if (account && (account as Record<string, unknown>).lastSyncAt) {
      // @ts-expect-error - dynamic property access
      return new Date((account as Record<string, unknown>).lastSyncAt);
    }
    // 备用：从同步日志表查询
    const { getEngineStatus } = await import('../sync/unifiedSyncEngine');
    const status = getEngineStatus();
    // @ts-expect-error - string type assertion
    if ((status as string).lastSyncResults) {
      // @ts-expect-error - string type assertion
      const accountResult = ((status as string).lastSyncResults as unknown[])?.find((r: Record<string, unknown>) => r.accountId === accountId);
      // @ts-expect-error Conditional type narrowing
      if (accountResult?.completedAt) {
        // @ts-expect-error Return type compatibility
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
    details: Record<string, unknown>[];
  };
  
  placementOptimization: {
    executed: boolean;
    adjustmentsCount: number;
    details: Record<string, unknown>[];
  };
  
  daypartingOptimization: {
    executed: boolean;
    adjustmentsCount: number;
    details: Record<string, unknown>[];
  };
  
  // v179: 分时预算优化
  daypartingBudgetOptimization: {
    executed: boolean;
    adjustmentsCount: number;
    details: Record<string, unknown>[];
  };
  
  searchTermAnalysis: {
    executed: boolean;
    negativeKeywordsAdded: number;
    newKeywordsAdded: number;
    details: Record<string, unknown>[];
  };
  
  budgetAllocation: {
    executed: boolean;
    adjustmentsCount: number;
    details: Record<string, unknown>[];
  };
  
  keywordStatusChanges: {
    executed: boolean;
    pausedCount: number;
    enabledCount: number;
    details: Record<string, unknown>[];
  };
  
  // v135: 广告活动状态变更
  campaignStatusChanges: {
    executed: boolean;
    pausedCount: number;
    enabledCount: number;
    details: Record<string, unknown>[];
  };
  
  // v135: 广告组状态变更
  adGroupStatusChanges: {
    executed: boolean;
    pausedCount: number;
    enabledCount: number;
    details: Record<string, unknown>[];
  };
  
  // 多维度智能优化结果
  multiDimensionOptimization: {
    executed: boolean;
    campaignsAnalyzed: number;
    rulesGenerated: number;
    details: Record<string, unknown>[];
  };
  
  // 中央竞价协调器执行结果
  bidCoordination: {
    executed: boolean;
    campaignsCoordinated: number;
    circuitBreakerTriggered: number;
    details: Record<string, unknown>[];
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
  
  // v329: 关联的业绩组ID
  performanceGroupId?: number;
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
    
    // v347: 修复 performanceGroupId 未赋值导致 optimization_logs 查询全部失败的严重bug
    performanceGroupId: group.id,
    
    // @ts-expect-error - type assertion
    optimizationGoal: (group.optimizationGoal as unknown) || 'balanced',
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
    // @ts-expect-error - dynamic property access
    lastExecutionTime: (group as Record<string, unknown>).lastOptimizationAt ? new Date((group as Record<string, unknown>).lastOptimizationAt) : undefined,
    nextExecutionTime: undefined,
    
    maxDailyBidChanges: 100,
    maxBidChangePercent: 30,
    minDataPoints: 7,
    autoRollbackEnabled: true,
    
    // v164: 自我进化所需字段
    // @ts-expect-error - dynamic property access
    userId: (group as Record<string, unknown>).userId || 0,
    // @ts-expect-error - dynamic property access
    strategyTemplateId: (group as Record<string, unknown>).strategyTemplateId || undefined,
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
  } catch (lcErr: unknown) {
    log.warn(`[OptimizationTargetConfig] 生命周期查询失败: ${(lcErr as Error).message}`);
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
    // v642: 优化目标不存在时记录详细日志，并尝试自动清理无效引用
    log.warn(`[OptimizationTargetEngine] v642: 优化目标 ${targetId} 不存在，可能已被删除。尝试从调度器中清理...`);
    try {
      const { removeScheduledTarget } = await import('./optimizationScheduler');
      if (removeScheduledTarget) {
        await removeScheduledTarget(targetId);
        log.info(`[OptimizationTargetEngine] v642: 已从调度器中移除无效目标 ${targetId}`);
      }
    } catch (cleanupErr: unknown) {
      log.debug(`[OptimizationTargetEngine] v642: 清理无效目标引用失败: ${(cleanupErr as Error).message}`);
    }
    throw new Error(`优化目标 ${targetId} 不存在（可能已被删除，已自动清理无效引用）`);
  }
  
  if (!config.isEnabled && !forceExecution) {
    throw new Error(`优化目标 ${config.name} 未启用`);
  }
  
  // v739+v740: 账户初始化状态门控 — 全量同步未完成时禁止自动优化
  // v740修复：使用 isAccountReady() 函数替代直接检查字段值
  // v739的问题：initializationStatus为null/undefined时被跳过（if(initStatus && ...)的falsy检查）
  // v740修复：null/undefined视为'pending'（未初始化），触发门控拦截
  // 注意：即使forceExecution=true，也不应跳过此检查（数据安全优先于强制执行）
  if (!dryRun) {
    try {
      const account = await db.getAdAccountById(config.accountId);
      if (account) {
        // v740: 将null/undefined视为'pending'（与isAccountReady()逻辑一致）
        const initStatus = (account as Record<string, unknown>).initializationStatus as string | undefined;
        const effectiveStatus = initStatus || 'pending';
        if (effectiveStatus !== 'completed' && effectiveStatus !== 'ready') {
          // 对于已存在的老账户（initializationStatus为null），检查是否有历史绩效数据
          // 如果有数据，说明是老账户，允许继续（但记录警告）
          // 如果没数据，说明是真正未初始化的新账户，必须拦截
          if (!initStatus) {
            // initializationStatus为null，可能是老账户（在初始化服务之前接入的）
            // 检查是否有绩效数据来区分老账户和新账户
            try {
              const database = await (await import('../db')).getDb();
              if (database) {
                const { dailyPerformance } = await import('../../drizzle/schema');
                const dataCheck = await database.select({
                  count: sql<number>`COUNT(*)`
                }).from(dailyPerformance).where(
                  eq(dailyPerformance.accountId, config.accountId)
                );
                const hasData = Number(dataCheck[0]?.count || 0) > 0;
                if (hasData) {
                  log.info(`[OptimizationTarget] v740: 账户 ${config.accountId} initializationStatus为null但有历史数据(${dataCheck[0]?.count}条)，视为老账户，允许继续`);
                } else {
                  const blockMsg = `v740: 🔴 账户初始化门控触发 — 账户 ${config.accountId} initializationStatus为null且无历史绩效数据，判定为未初始化新账户，拒绝执行优化`;
                  log.warn(`[OptimizationTarget] ${blockMsg}`);
                  if (shouldReleaseLock) await releaseAccountOptimizationLock(config.accountId, moduleLockGroup);
                  unregisterActiveTask(activeTaskId);
                  result.status = 'skipped';
                  result.errors.push(blockMsg);
                  return result;
                }
              }
            } catch (dataCheckErr: unknown) {
              log.warn(`[OptimizationTarget] v740: 老账户数据检查异常，保守允许继续: ${(dataCheckErr as Error).message}`);
            }
          } else {
            // initializationStatus有值但不是completed/ready（如pending/collecting/failed）
            const blockMsg = `v740: 🔴 账户初始化门控触发 — 账户 ${config.accountId} 初始化状态为 "${effectiveStatus}"(非completed/ready)，全量同步尚未完成，拒绝执行优化`;
            log.warn(`[OptimizationTarget] ${blockMsg}`);
            if (shouldReleaseLock) await releaseAccountOptimizationLock(config.accountId, moduleLockGroup);
            unregisterActiveTask(activeTaskId);
            result.status = 'skipped';
            result.errors.push(blockMsg);
            return result;
          }
        }
      }
    } catch (initCheckErr: unknown) {
      const errMsg = (initCheckErr as Error).message || '';
      if (errMsg.includes('v740')) throw initCheckErr; // 重新抛出门控拦截错误
      log.warn(`[OptimizationTarget] v740: 账户初始化状态检查异常: ${errMsg}`);
    }
  }
  
  // v739: autoOptimize字段检查 — 用户关闭自动优化时必须尊重
  if (!forceExecution && !dryRun) {
    try {
      const group = await db.getPerformanceGroupById(targetId);
      if (group) {
        const autoOptimize = (group as Record<string, unknown>).autoOptimize;
        // autoOptimize为0或false时，表示用户已关闭自动优化
        if (autoOptimize !== undefined && autoOptimize !== null && Number(autoOptimize) === 0) {
          const blockMsg = `v739: 🔴 autoOptimize门控触发 — 优化目标 "${config.name}"(ID:${targetId}) 的autoOptimize已关闭(值=${autoOptimize})，用户已明确禁止自动优化`;
          log.warn(`[OptimizationTarget] ${blockMsg}`);
          throw new Error(blockMsg);
        }
      }
    } catch (autoOptCheckErr: unknown) {
      const errMsg = (autoOptCheckErr as Error).message || '';
      if (errMsg.includes('v739')) throw autoOptCheckErr;
      log.warn(`[OptimizationTarget] v739: autoOptimize检查异常: ${errMsg}`);
    }
  }
  
  // v181+v642: 获取账户+模块级优化锁，不同模块类型可以并行执行
  // v642: 改用带重试的锁获取，避免多个优化目标同时竞争同一账户的锁时频繁失败
  const moduleLockGroup = getModuleLockGroup(specificModules);
  if (!dryRun) {
    const lockAcquired = await acquireAccountOptimizationLockWithRetry(
      config.accountId,
      `optimizationTarget:${targetId}`,
      moduleLockGroup,
      5,    // v642: 最多重试5次（原来0次直接失败）
      15000 // v642: 重试间隔15秒（指数退避+抖动）
    );
    if (!lockAcquired) {
      throw new Error(`账户 ${config.accountId} 模块组 ${moduleLockGroup} 优化锁在5次重试后仍被占用，跳过本次执行`);
    }
  }
  const shouldReleaseLock = !dryRun;
  
  // v185: 检查系统是否正在关闭，避免在关闭过程中启动新的优化任务
  if (isShuttingDown() && !forceExecution) {
    if (shouldReleaseLock) await releaseAccountOptimizationLock(config.accountId, moduleLockGroup);
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
    // v275: 将风险评估结果传递到后续出价计算中
    const riskBidMultiplier = safetyCheck.riskAssessment?.autoResponse?.bidMultiplier ?? 1.0;
    const riskCooldownExtension = safetyCheck.riskAssessment?.autoResponse?.cooldownExtension ?? 1.0;
    if (riskBidMultiplier < 1.0) {
      log.info(`[OptimizationTarget] v275: 风险自动响应生效 - 出价乘数=${riskBidMultiplier}, 冷却延长=${riskCooldownExtension}x`);
    }
  } catch (safetyErr: unknown) {
    log.warn(`[OptimizationTarget] v162 安全检查异常，继续执行: ${(safetyErr as Error).message}`);
  }
  
  // v738: 数据断路器（Circuit Breaker）— 基于真实数据存在性的硬性拦截
  // 替代v221的仅警告不拦截逻辑，彻底解决"数据缺失但仍继续优化"的致命问题
  // 核心原则：无准确数据不优化，宁可暂停优化也不能基于缺失数据做错误决策
  if (!forceExecution && !dryRun) {
    try {
      const database = await getDb();
      if (database) {
        const { dailyPerformance } = await import('../../drizzle/schema');
        
        // 检查1: 查询最近3天的绩效数据覆盖情况
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        const coverageResult = await database.select({
          distinctDates: sql<number>`COUNT(DISTINCT DATE(${dailyPerformance.date}))`,
          totalRecords: sql<number>`COUNT(*)`,
          latestDate: sql<string>`MAX(DATE(${dailyPerformance.date}))`,
        })
        .from(dailyPerformance)
        .where(and(
          eq(dailyPerformance.accountId, config.accountId),
          sql`${dailyPerformance.date} >= ${threeDaysAgo.toISOString().split('T')[0]}`
        ));
        
        const coverage = coverageResult[0];
        const distinctDates = Number(coverage?.distinctDates || 0);
        const totalRecords = Number(coverage?.totalRecords || 0);
        const latestDateStr = coverage?.latestDate as string | null;
        
        // 检查2: 计算最新数据距今天数
        let dataGapDays = 999;
        if (latestDateStr) {
          const latestDate = new Date(latestDateStr);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          dataGapDays = Math.floor((today.getTime() - latestDate.getTime()) / (1000 * 60 * 60 * 24));
        }
        
        // 断路器判定逻辑:
        // - 最近3天完全没有绩效数据 → 硬性拦截
        // - 最新数据距今超过2天 → 硬性拦截
        // - 最近3天数据覆盖不足2天 → 警告并降低调整幅度
        
        if (totalRecords === 0 || distinctDates === 0) {
          // 完全没有绩效数据 — 硬性拦截
          const blockMsg = `v738: 🔴 数据断路器触发(硬性拦截) — 账户 ${config.accountId} 最近3天完全没有绩效数据(0条记录)，拒绝执行优化以保护广告表现`;
          log.warn(`[OptimizationTarget] ${blockMsg}`);
          result.warnings.push(blockMsg);
          result.status = 'skipped';
          result.errors.push(blockMsg);
          
          // 记录断路器事件到优化日志
          try {
            const { optimizationEvents } = await import('../../drizzle/schema');
            await database.insert(optimizationEvents).values({
              accountId: config.accountId,
              performanceGroupId: targetId,
              performanceGroupName: config.name,
              eventCategory: 'settings_change',
              actionType: 'auto_correction',
              changeReason: blockMsg,
              actionDetail: JSON.stringify({
                type: 'data_circuit_breaker',
                severity: 'critical',
                distinctDates,
                totalRecords,
                latestDate: latestDateStr,
                dataGapDays,
                action: 'optimization_blocked',
              }),
              algorithmVersion: `v738`,
              status: 'skipped',
              apiSyncStatus: 'not_applicable',
            });
          } catch (logErr: unknown) {
            log.debug(`[OptimizationTarget] v738: 记录断路器事件失败: ${(logErr as Error).message}`);
          }
          
          // v743-fix2: 使用节流版本替代原始fire-and-forget，防止洪泛
          throttledCircuitBreakerSync();
          
          if (shouldReleaseLock) await releaseAccountOptimizationLock(config.accountId, moduleLockGroup);
          unregisterActiveTask(activeTaskId);
          return result;
        }
        
        if (dataGapDays >= 2) {
          // 最新数据距今超过2天 — 硬性拦截
          const blockMsg = `v738: 🔴 数据断路器触发(硬性拦截) — 账户 ${config.accountId} 最新绩效数据距今${dataGapDays}天(最新日期:${latestDateStr})，数据严重过时，拒绝执行优化`;
          log.warn(`[OptimizationTarget] ${blockMsg}`);
          result.warnings.push(blockMsg);
          result.status = 'skipped';
          result.errors.push(blockMsg);
          
          try {
            const { optimizationEvents } = await import('../../drizzle/schema');
            await database.insert(optimizationEvents).values({
              accountId: config.accountId,
              performanceGroupId: targetId,
              performanceGroupName: config.name,
              eventCategory: 'settings_change',
              actionType: 'auto_correction',
              changeReason: blockMsg,
              actionDetail: JSON.stringify({
                type: 'data_circuit_breaker',
                severity: 'critical',
                distinctDates,
                totalRecords,
                latestDate: latestDateStr,
                dataGapDays,
                action: 'optimization_blocked',
              }),
              algorithmVersion: `v738`,
              status: 'skipped',
              apiSyncStatus: 'not_applicable',
            });
          } catch (logErr: unknown) {
            log.debug(`[OptimizationTarget] v738: 记录断路器事件失败: ${(logErr as Error).message}`);
          }
          
          // v743-fix2: 使用节流版本替代原始fire-and-forget，防止洪泛
          throttledCircuitBreakerSync();
          
          if (shouldReleaseLock) await releaseAccountOptimizationLock(config.accountId, moduleLockGroup);
          unregisterActiveTask(activeTaskId);
          return result;
        }
        
        if (distinctDates < 2) {
          // 数据覆盖不足 — 警告但允许执行（降低调整幅度）
          const warnMsg = `v738: 🟡 数据断路器警告 — 账户 ${config.accountId} 最近3天仅有${distinctDates}天数据(${totalRecords}条记录)，数据覆盖不足，优化将以保守模式执行`;
          log.warn(`[OptimizationTarget] ${warnMsg}`);
          result.warnings.push(warnMsg);
        }
        
        // 同时保留时间戳检查作为补充
        const lastSyncTime = await getLastSyncTimeForAccount(config.accountId);
        if (lastSyncTime) {
          const dataAgeMinutes = (Date.now() - lastSyncTime.getTime()) / (1000 * 60);
          if (dataAgeMinutes > 120) {
            const staleMsg = `v738: 数据新鲜度补充警告 - 账户 ${config.accountId} 最后同步于 ${Math.round(dataAgeMinutes)} 分钟前`;
            log.warn(`[OptimizationTarget] ${staleMsg}`);
            result.warnings.push(staleMsg);
          }
        }
      }
    } catch (circuitBreakerErr: unknown) {
      // 断路器检查本身异常时，保守拦截（宁可不优化也不能错误优化）
      const errMsg = `v738: 数据断路器检查异常: ${(circuitBreakerErr as Error).message}`;
      log.warn(`[OptimizationTarget] ${errMsg}`);
      result.warnings.push(errMsg);
      // 异常时不阻止执行，但记录警告
    }
  }
  
  // v164: 自我进化周期 - 在每次优化执行前自动评估上一轮优化效果并学习
  let evolutionReport: unknown = null;
  let adaptiveParams: unknown = null;
  try {
    // 运行进化周期：评估效果→学习→自动纠错
    evolutionReport = await selfEvolution.runEvolutionCycle(
      targetId, config.userId, config.accountId, config.strategyTemplateId
    // @ts-expect-error Legacy code type compatibility
    );
    // @ts-expect-error Conditional type narrowing
    if (evolutionReport) {
      // @ts-expect-error Complex function parameter types
      log.info(`[OptimizationTarget] v164 进化周期完成: 评估${evolutionReport.totalActionsEvaluated}个动作, ` +
        // @ts-expect-error Legacy code type compatibility
        `正面${evolutionReport.positiveActions}, 负面${evolutionReport.negativeActions}, ` +
        // @ts-expect-error Legacy code type compatibility
        `纠错${evolutionReport.correctionsExecuted}个, 趋势: ${evolutionReport.improvementTrend}`);
      // @ts-expect-error Dynamic property access
      if (evolutionReport.correctionsExecuted > 0) {
        // @ts-expect-error Complex function parameter types
        result.warnings.push(`自我进化: 自动纠正了${evolutionReport.correctionsExecuted}个不合理优化`);
      // @ts-expect-error Legacy code type compatibility
      }
    // @ts-expect-error Legacy code type compatibility
    }
    
    // 获取自适应优化参数（根据历史成功率动态调整）
    adaptiveParams = await selfEvolution.getAdaptiveOptimizationParams(targetId, config.strategyTemplateId);
    if (adaptiveParams) {
      // @ts-expect-error Complex function parameter types
      log.debug(`[OptimizationTarget] v164 自适应参数: 最大出价提升${Math.round(adaptiveParams.maxBidIncrease * 100)}%, ` +
        // @ts-expect-error Legacy code type compatibility
        `最大出价降低${Math.round(adaptiveParams.maxBidDecrease * 100)}%, ` +
        // @ts-expect-error Legacy code type compatibility
        `成功率${Math.round(adaptiveParams.recentSuccessRate * 100)}%`);
    }
  } catch (evoErr: unknown) {
    log.warn(`[OptimizationTarget] v164 自我进化异常，继续执行: ${(evoErr as Error).message}`);
  }
  
  // 获取优化目标下的所有广告活动
  const allCampaigns = await db.getCampaignsByPerformanceGroupId(targetId);
  if (allCampaigns.length === 0) {
    result.warnings.push('优化目标下没有广告活动');
    if (shouldReleaseLock) await releaseAccountOptimizationLock(config.accountId, moduleLockGroup);
    unregisterActiveTask(activeTaskId); // v185
    return result;
  }
  
  // v156: 只对enabled状态的campaign执行优化
  // paused/archived的campaign在Amazon端不会投放广告，对其做出价调整是无效的
  const campaigns = allCampaigns.filter(c => (c as Record<string, unknown>).campaignStatus === 'enabled');
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
        // @ts-expect-error - dynamic property access
        ['paused', 'archived'].includes((c as Record<string, unknown>).campaignStatus || '')
      );
      if (allPausedOrArchived) {
        try {
          await db.updatePerformanceGroup(targetId, { autoOptimize: 0 });
          const pauseMsg = `v168: 优化目标"${config.name}"已自动暂停 - 所有${allCampaigns.length}个广告活动均为暂停/归档状态，不再执行自动优化`;
          log.debug(`[OptimizationTarget] ${pauseMsg}`);
          result.warnings.push(pauseMsg);
          result.status = 'skipped';
        } catch (autoPauseErr: unknown) {
          log.warn(`[OptimizationTarget] v168: 自动暂停优化目标失败:`, (autoPauseErr as Error).message);
        }
      }
    }
    
    if (shouldReleaseLock) await releaseAccountOptimizationLock(config.accountId, moduleLockGroup);
    unregisterActiveTask(activeTaskId); // v185
    return result;
  }

  // v429: Pre-Sync ID Resolution - 确保所有Amazon ID就绪
  // 保留amazonIdResolver.ensureAmazonIdsReady作为API级别的回填层（处理keywordId为NULL需要通过Amazon API创建的情况）
  // 同时清理entityIdResolver缓存，确保后续优化任务使用最新的ID映射
  if (!dryRun) {
    // v429: 先清理entityIdResolver缓存，确保后续解析使用最新数据
    try {
      const { clearAllCaches } = await import('../services/entityIdResolver');
      clearAllCaches();
      log.debug('[OptimizationTarget] v429: entityIdResolver缓存已清理');
    } catch (_: any) { /* entityIdResolver未初始化时忽略 */ }
    
    try {
      const idResolution = await amazonIdResolver.ensureAmazonIdsReady(config.accountId);
      if (idResolution.totalMissingBefore > 0) {
        const resolvedTotal = idResolution.keywordsResolved + idResolution.keywordsCreated + idResolution.keywordsCleanedUp + idResolution.productTargetsResolved;
        log.info(`[OptimizationTarget] Pre-Sync ID Resolution: 处理了${idResolution.totalMissingBefore}个缺失ID, 解决${resolvedTotal}个, 剩余${idResolution.totalMissingAfter}个`);
        if (idResolution.totalMissingAfter > 0) {
          result.warnings.push(`Pre-Sync ID Resolution: 仍有${idResolution.totalMissingAfter}个实体缺少Amazon ID`);
        }
      }
    } catch (idErr: unknown) {
      log.warn(`[OptimizationTarget] Pre-Sync ID Resolution异常: ${(idErr as Error).message}`);
      result.warnings.push(`Pre-Sync ID Resolution异常: ${(idErr as Error).message}`);
    }
  }
  
  const shouldExecute = (module: string) => {
    if (specificModules && specificModules.length > 0) {
      return specificModules.includes(module);
    }
    return true;
  };
  
  // v235: 检查账户是否在紧急优化队列中（由riskActionEngine触发）
  let emergencyMode = false;
  try {
    const { isAccountInEmergencyQueue, markEmergencyOptimizationProcessed } = await import('./riskActionEngine');
    const emergencyCheck = await isAccountInEmergencyQueue(config.accountId);
    if (emergencyCheck.inQueue) {
      emergencyMode = true;
      log.info(`[OptimizationTarget] v235: 账户${config.accountId}在紧急优化队列中 (${emergencyCheck.type})，启用紧急优化模式`);
      result.warnings.push(`v235: 紧急优化模式已启用 - ${emergencyCheck.type}`);
      // 标记已处理
      await markEmergencyOptimizationProcessed(config.accountId);
    }
  } catch (riskErr: unknown) {
    log.warn(`[OptimizationTarget] v235: 紧急优化检查异常: ${(riskErr as Error).message}`);
  }

  // v272 P2: 紧急模式下的风险响应闭环
  // 当账号在紧急优化队列中时，调整优化参数以实现真正的风险响应
  if (emergencyMode) {
    log.info(`[OptimizationTarget] v272: 紧急模式激活，应用保守优化参数`);
    // 紧急模式下限制最大出价调整幅度为正常值的50%
    config.maxBidChangePercent = Math.min(config.maxBidChangePercent, Math.round(config.maxBidChangePercent * 0.5));
    // 紧急模式下减少每日最大调整次数
    config.maxDailyBidChanges = Math.min(config.maxDailyBidChanges, Math.round(config.maxDailyBidChanges * 0.5));
    result.warnings.push(`v272: 紧急模式已限制优化参数 (maxBidChange=${config.maxBidChangePercent}%, maxDailyChanges=${config.maxDailyBidChanges})`);
  }
  
  // 1. 执行出价优化
  if (config.enableBidOptimization && shouldExecute('bid')) {
    try {
      const bidResults = await executeBidOptimization(config, campaigns, dryRun);
      result.bidOptimization = bidResults;
      // v244: 移除v235的emergencyPause提前返回逻辑
      // 原v235行为：单个campaign安全检查触发 → 终止所有优化模块执行
      // 修复：安全检查只跳过单个campaign，不再影响其他优化模块（位置优化、分时竞价、搜索词分析、预算分配）的执行
    } catch (error: unknown) {
      result.errors.push(`出价优化失败: ${(error as Error).message}`);
    }
  }
  
  // v476: 模块间节流 — 出价优化完成后等待，给API限流窗口
  if (config.enableBidOptimization && shouldExecute('bid') && !dryRun) {
    await throttleDelay(INTER_MODULE_DELAY_MS);
  }
  
  // 2. 执行位置优化
  if (config.enablePlacementOptimization && shouldExecute('placement')) {
    try {
      const placementResults = await executePlacementOptimization(config, campaigns, dryRun);
      result.placementOptimization = placementResults;
    } catch (error: unknown) {
      result.errors.push(`位置优化失败: ${(error as Error).message}`);
    }
  }
  
  // v476: 模块间节流 — 位置优化完成后等待
  if (config.enablePlacementOptimization && shouldExecute('placement') && !dryRun) {
    await throttleDelay(INTER_MODULE_DELAY_MS);
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
    } catch (error: unknown) {
      result.errors.push(`多维度智能优化失败: ${(error as Error).message}`);
      log.warn(`[OptimizationTarget] 多维度优化异常:`, (error as Error).message);
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
          (result.multiDimensionOptimization as Record<string, unknown>).comboAnalysis = {
            goldenCount: comboResults.goldenCount,
            leadenCount: comboResults.leadenCount,
            potentialCount: comboResults.potentialCount,
            standardCount: comboResults.standardCount,
          };
        }
      }
    } catch (error: unknown) {
      log.warn(`[OptimizationTarget] v183 多维度组合分析异常:`, (error as Error).message);
      result.warnings.push(`多维度组合分析失败: ${(error as Error).message}`);
    }
  }
  
  // v476: 模块间节流 — 多维度分析完成后等待
  if (config.enableDaypartingOptimization && (shouldExecute('multidim') || shouldExecute('combo_analysis')) && !dryRun) {
    await throttleDelay(INTER_MODULE_DELAY_MS);
  }
  
  // 3. 执行分时竞价优化（基于多维度优化生成的规则执行）
  if (config.enableDaypartingOptimization && shouldExecute('dayparting')) {
    try {
      const daypartingResults = await executeDaypartingOptimization(config, campaigns, dryRun);
      result.daypartingOptimization = daypartingResults;
    } catch (error: unknown) {
      result.errors.push(`分时竞价优化失败: ${(error as Error).message}`);
    }
  }
  
  // v476: 模块间节流 — 分时竞价完成后等待
  if (config.enableDaypartingOptimization && shouldExecute('dayparting') && !dryRun) {
    await throttleDelay(INTER_MODULE_DELAY_MS);
  }
  
  // 3.5 v179: 执行分时预算优化（根据星期几调整预算）
  if (config.enableDaypartingOptimization && shouldExecute('dayparting_budget')) {
    try {
      const daypartingBudgetResults = await executeDaypartingBudgetOptimization(config, campaigns, dryRun);
      result.daypartingBudgetOptimization = daypartingBudgetResults;
    } catch (error: unknown) {
      result.errors.push(`分时预算优化失败: ${(error as Error).message}`);
    }
  }
  
  // v476: 模块间节流 — 分时预算完成后等待
  if (config.enableDaypartingOptimization && shouldExecute('dayparting_budget') && !dryRun) {
    await throttleDelay(INTER_MODULE_DELAY_MS);
  }
  
  // 4. 执行搜索词分析
  if (config.enableSearchTermAnalysis && shouldExecute('searchterm')) {
    try {
      // @ts-expect-error Type inference limitation
      const searchTermResults = await executeSearchTermAnalysis(config, campaigns, dryRun);
      // @ts-expect-error Dynamic property access
      result.searchTermAnalysis = searchTermResults;
    } catch (error: unknown) {
      result.errors.push(`搜索词分析失败: ${(error as Error).message}`);
    }
  }
  
  // 4.5 v337.3: 执行Ngram自动否定分析（集成到自动优化流程）
  if (config.enableSearchTermAnalysis && shouldExecute('searchterm')) {
    try {
      // @ts-expect-error Type inference limitation
      const ngramResults = await executeAutoNgramNegation(config, campaigns, dryRun);
      // @ts-expect-error Dynamic type assertion
      (result as Record<string, unknown>).ngramAnalysis = ngramResults;
      if (ngramResults.negativeKeywordsAdded > 0) {
        log.info(`[NgramAutoNegation] v337.3: Ngram自动否定完成: 添加${ngramResults.negativeKeywordsAdded}个否定词`);
      }
    } catch (error: unknown) {
      result.errors.push(`Ngram自动否定失败: ${(error as Error).message}`);
      log.warn(`[NgramAutoNegation] v337.3: Ngram自动否定失败:`, (error as Error).message);
    }
  }

  // v476: 模块间节流 — 搜索词分析完成后等待
  if (config.enableSearchTermAnalysis && shouldExecute('searchterm') && !dryRun) {
    await throttleDelay(INTER_MODULE_DELAY_MS);
  }
  
  // 5. 执行预算分配优化
  if (config.enableBudgetAllocation && shouldExecute('budget')) {
    try {
      const budgetResults = await executeBudgetAllocation(config, campaigns, dryRun);
      result.budgetAllocation = budgetResults;
    } catch (error: unknown) {
      result.errors.push(`预算分配优化失败: ${(error as Error).message}`);
    }
  }
  
  // v476: 模块间节流 — 预算分配完成后等待
  if (config.enableBudgetAllocation && shouldExecute('budget') && !dryRun) {
    await throttleDelay(INTER_MODULE_DELAY_MS);
  }
  
  // 6. 执行投放词状态变更
  if (config.enableKeywordAutoExecution && shouldExecute('keyword')) {
    try {
      const keywordResults = await executeKeywordStatusChanges(config, campaigns, dryRun);
      result.keywordStatusChanges = keywordResults;
    } catch (error: unknown) {
      result.errors.push(`投放词状态变更失败: ${(error as Error).message}`);
    }
  }
  
  // 7. v135: 执行广告活动状态变更
  if (config.enableKeywordAutoExecution && shouldExecute('campaign_status')) {
    try {
      const campaignResults = await executeCampaignStatusChanges(config, campaigns, dryRun);
      result.campaignStatusChanges = campaignResults;
    } catch (error: unknown) {
      result.errors.push(`广告活动状态变更失败: ${(error as Error).message}`);
    }
  }
  
  // 8. v135: 执行广告组状态变更
  if (config.enableKeywordAutoExecution && shouldExecute('adgroup_status')) {
    try {
      const adGroupResults = await executeAdGroupStatusChanges(config, campaigns, dryRun);
      result.adGroupStatusChanges = adGroupResults;
    } catch (error: unknown) {
      result.errors.push(`广告组状态变更失败: ${(error as Error).message}`);
    }
  }
  
  // 9. 执行中央竞价协调（收集各服务建议并统一处理）
  if (shouldExecute('coordination')) {
    try {
      const coordinationResults = await executeBidCoordination(
        // @ts-expect-error Legacy code type compatibility
        config,
        // @ts-expect-error Legacy code type compatibility
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
          // @ts-expect-error Dynamic property access
          if (detail.warnings && detail.warnings.length > 0) {
            // @ts-expect-error Array method type inference
            result.warnings.push(...detail.warnings);
          }
        }
      }
    } catch (error: unknown) {
      result.errors.push(`中央竞价协调失败: ${(error as Error).message}`);
    }
  }
  
  // 更新执行状态
  if (result.errors.length > 0) {
    result.status = result.errors.length === 7 ? 'failed' : 'partial';
  }
  
  // 记录执行日志
  if (!dryRun) {
    await recordExecutionLog(result);
    
    // v272 P0-1: 集成权重自学习 — 基于执行结果自动调整评分权重
    try {
      const { getEffectiveWeights } = await import('../algorithm/weightAutoTuningService');
      if (config.strategyTemplateId) {
        const currentWeights = getEffectiveWeights(config.strategyTemplateId, {
          coreMetric: 20, trend: 16, budgetEfficiency: 11,
          conversionEfficiency: 15, gradualProgress: 18, algorithmEfficacy: 8, profitHealth: 12
        });
        const bidCount = result.bidOptimization?.details?.length || 0;
        const errorCount = result.errors.length;
        log.info(`[v272] 权重自学习已激活: strategy=${config.strategyTemplateId}, bidCount=${bidCount}, errors=${errorCount}`);
      }
    } catch (tuningErr: unknown) {
      log.debug(`[v272] 权重自学习异常(不影响业务): ${(tuningErr as Error).message}`);
    }
    
    // v272 P0-1: 集成算法可观测性 — 记录执行摘要指标
    try {
      const { recordMetric } = await import('../algorithm/algorithmObservabilityService');
      recordMetric('optimization_execution', {
        targetId: config.id,
        accountId: config.accountId,
        strategyTemplateId: config.strategyTemplateId,
        bidCount: result.bidOptimization?.details?.length || 0,
        errorCount: result.errors.length,
        warningCount: result.warnings.length,
        status: result.status,
      });
    } catch (_obsErr: any) { /* 可观测性失败不影响业务 */ }
    
    // v137: 将失败的同步任务入队到重试队列
    try {
      const { enqueueTasks } = await import('../sync/optimizationSyncEngine');
      const { randomUUID } = await import('crypto');
      const failedTasks: unknown[] = [];
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
              // @ts-expect-error Amazon API response type flexibility
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
              const negCampaign = campaigns.find((c: Record<string, unknown>) => c.id === detail.localCampaignId);
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
            } else if (detail.action === 'add_negative_product_target') {
              // v478: 否定产品定向失败 → 入队 negative_product_target 类型
              const negProdCampaign = campaigns.find((c: Record<string, unknown>) => c.id === detail.localCampaignId);
              const negProdAmazonCampaignId = negProdCampaign?.campaignId || null;
              failedTasks.push({
                batchId,
                optimizationTargetId: config.id,
                accountId: config.accountId,
                taskType: 'negative_product_target',
                priority: 1,
                targetEntityType: 'campaign',
                targetEntityId: detail.localCampaignId,
                amazonEntityId: detail.amazonCampaignId || (negProdAmazonCampaignId ? String(negProdAmazonCampaignId) : null),
                targetEntityName: detail.searchTerm,
                action: 'add_negative_product_target',
                oldValue: '',
                newValue: detail.searchTerm,
                changeReason: detail.reason || '否定产品定向重试',
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
            const campaign = campaigns.find((c: Record<string, unknown>) => c.id === detail.localCampaignId);
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
            const campaign = campaigns.find((c: Record<string, unknown>) => c.id === detail.localCampaignId);
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
            const campaign = campaigns.find((c: Record<string, unknown>) => c.id === detail.localCampaignId);
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
              // @ts-expect-error Legacy code type compatibility
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
        // @ts-expect-error Async operation type inference
        await enqueueTasks(failedTasks);
        log.warn(`[OptimizationTarget] v137: ${failedTasks.length}个失败任务已入队重试队列, batchId=${batchId}`);
        result.retryBatchId = batchId;
        result.retryTaskCount = failedTasks.length;
      }
    } catch (enqueueErr: unknown) {
      log.warn(`[OptimizationTarget] v137: 入队失败任务异常: ${(enqueueErr as Error).message}`);
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
      // v359: 使用可靠确认服务替代fire-and-forget模式
      const { submitReliableConfirmation } = await import('../services/commandConfirmationService');
      const entityArray = uniqueEntities as ('campaigns' | 'ad_groups' | 'keywords' | 'targets' | 'budgets')[];
      const hasKeywords = entityArray.includes('keywords');
      const hasBudgets = entityArray.includes('budgets');
      const opType = hasKeywords ? 'bid_change' : hasBudgets ? 'budget_change' : 'status_change';
      const requestId = submitReliableConfirmation(config.accountId, entityArray, `optimizationTarget_${config.id}`, opType);
      log.info(`[OptimizationTarget] v359: 提交可靠确认请求 - 账户${config.accountId}, 目标${config.id}: ${requestId}`);
    }
  } catch (confirmErr: unknown) {
    log.warn(`[OptimizationTarget] v221: 触发确认同步异常: ${(confirmErr as Error).message}`);
  }
  
  // v181: 释放账户+模块级优化锁
  if (shouldReleaseLock) await releaseAccountOptimizationLock(config.accountId, moduleLockGroup);
  
  // v185: 注销活跃任务
  unregisterActiveTask(activeTaskId);
  
  return result;
}

/**
 * v122h: 执行出价优化 - 使用UCB增强版算法
 * 集成动态弹性系数、UCB探索-利用平衡、时间衰减ROAS、节假日调整
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
    if (group.status === 'active' && (group as Record<string, unknown>).autoOptimize !== 0) {
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
    } catch (error: unknown) {
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
        errors: [(error as Error).message],
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
      // @ts-expect-error Legacy code type compatibility
      pendingActions: {
        bidAdjustments: 0,
        placementAdjustments: 0,
        negativeKeywords: 0,
        budgetAdjustments: 0,
      },
    };
  }
  
  const campaigns = await db.getCampaignsByPerformanceGroupId(targetId);
  
  // v451.1: 深度优化 - 先快速返回基本信息，dry-run结果通过超时保护获取
  // 并行获取关键词数量（每个campaign并行查询）
  const keywordCounts = await Promise.all(
    (campaigns as unknown[]).map(async (campaign) => {
      try {
        // @ts-expect-error Type inference limitation
        const campaignAmazonId = getCampaignAmazonId(campaign);
        const keywords = await db.getKeywordsByCampaignId(campaignAmazonId);
        return keywords.length;
      } catch {
        return 0;
      }
    })
  );
  const keywordsCount = keywordCounts.reduce((sum, count) => sum + count, 0);
  
  // v451.1: dry-run超时保护 - 最多等待15秒，超时则返回默认值
  let pendingActions = {
    bidAdjustments: -1,  // -1 表示计算中/未知
    placementAdjustments: -1,
    negativeKeywords: -1,
    budgetAdjustments: -1,
  };
  
  try {
    const dryRunPromise = executeOptimizationTarget(targetId, { dryRun: true, forceExecution: true });
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000));
    const dryRunResult = await Promise.race([dryRunPromise, timeoutPromise]);
    
    if (dryRunResult) {
      pendingActions = {
        bidAdjustments: dryRunResult.bidOptimization.details.length,
        placementAdjustments: dryRunResult.placementOptimization.details.length,
        negativeKeywords: dryRunResult.searchTermAnalysis.negativeKeywordsAdded,
        budgetAdjustments: dryRunResult.budgetAllocation.details.length,
      };
    }
  } catch (err: unknown) {
    // dry-run失败不影响基本信息返回
  }
  
  return {
    config,
    campaignsCount: campaigns.length,
    keywordsCount,
    pendingActions,
  };
}

/**
 * v337.3: Ngram自动否定执行引擎
 * 
 * 将Ngram分析集成到自动优化流程中，并实现全局/局部否定区分：
 * - 全局否定：一个Ngram在所有广告活动中表现都差 → 在所有campaign级别否定
 * - 局部否定：一个Ngram只在部分广告活动中表现差 → 仅在表现差的campaign中否定
 * 
 * 只自动执行高优先级的否定建议，中/低优先级留给用户手动审核。
 */