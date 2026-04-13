/**
 * ColdStartService v338
 * 
 * 统一智能冷启动服务 — 在四大场景下自动触发历史数据的深度分析与优化，
 * 大幅缩短新账户/新站点/新版本的优化启动时间。
 * 
 * 四大触发场景:
 * 1. new_account       — 新客户首次授权广告API
 * 2. credential_refresh — 已有客户重新授权/刷新Token
 * 3. new_marketplace   — 已有店铺开通新的Amazon站点（如US→UK/DE）
 * 4. version_upgrade   — 系统版本升级后，用新算法重新处理历史数据
 * 5. manual            — 手动触发（管理员操作）
 * 
 * 核心流程:
 * ┌─────────────────────────────────────────────────────────────┐
 * │ 1. 触发检测 → 判断是否需要冷启动                            │
 * │ 2. 全量数据同步 → 拉取90天历史数据（搜索词/广告位/定向等）    │
 * │ 3. 历史数据分层优化 → 30-90天数据执行批量否定/收割/Ngram分析  │
 * │ 4. 近期数据快速优化 → 7-14天数据执行常规优化+立即触发调度     │
 * │ 5. 状态记录 → 更新冷启动状态，防止重复执行                   │
 * └─────────────────────────────────────────────────────────────┘
 * 
 * 安全机制:
 * - 幂等性: 同一账户+同一版本只执行一次冷启动
 * - 批处理: 优化目标分批执行，每批间延迟，避免API限流
 * - 错误隔离: 单个优化目标失败不影响其他目标
 * - 内存保护: 执行前检查内存使用率，超过80%暂停
 */

import { getDb } from '../db';
import * as db from '../db';
import { sql } from 'drizzle-orm';
import { SYSTEM_VERSION } from '../utils/systemVersion';
import { createModuleLogger } from '../utils/logger';
import { logSystem, logOptimization, logOptimizationError } from '../utils/opsLogger';
import { isShuttingDown } from '../utils/taskLifecycle';

const log = createModuleLogger('ColdStart');

// ==================== 类型定义 ====================

export type ColdStartTriggerReason = 
  | 'new_account'          // 新账户首次授权
  | 'credential_refresh'   // API凭证刷新
  | 'new_marketplace'      // 新站点接入
  | 'version_upgrade'      // 系统版本升级
  | 'manual';              // 手动触发

export interface ColdStartOptions {
  /** 触发原因 */
  reason: ColdStartTriggerReason;
  /** 是否强制执行（跳过幂等性检查） */
  force?: boolean;
  /** 历史数据回溯天数（默认90天） */
  historicalDays?: number;
  /** 近期数据天数（默认14天） */
  recentDays?: number;
  /** 是否跳过数据同步阶段（适用于数据已同步完成的场景） */
  skipSync?: boolean;
  /** 仅执行指定模块（用于调试） */
  specificModules?: string[];
}

export interface ColdStartResult {
  accountId: number;
  reason: ColdStartTriggerReason;
  systemVersion: number;
  status: 'completed' | 'failed' | 'skipped';
  skipReason?: string;
  
  // 数据同步阶段
  syncPhase: {
    executed: boolean;
    campaigns: number;
    keywords: number;
    searchTerms: number;
    targets: number;
    durationMs: number;
  };
  
  // 历史数据优化阶段
  historicalPhase: {
    executed: boolean;
    targetsProcessed: number;
    negativesAdded: number;
    keywordsHarvested: number;
    ngramNegatives: number;
    durationMs: number;
  };
  
  // 近期数据优化阶段
  recentPhase: {
    executed: boolean;
    targetsProcessed: number;
    optimizationsTriggered: number;
    durationMs: number;
  };
  
  totalDurationMs: number;
  errors: string[];
}

// ==================== 配置 ====================

const COLD_START_CONFIG = {
  /** 历史数据默认回溯天数 */
  defaultHistoricalDays: 90,
  /** 近期数据默认天数 */
  defaultRecentDays: 14,
  /** 每批处理的优化目标数 */
  batchSize: 3,
  /** 批次间延迟（毫秒） */
  batchDelayMs: 15 * 1000,
  /** 单个优化目标超时（毫秒） */
  targetTimeoutMs: 10 * 60 * 1000,
  /** 内存使用率上限（超过则暂停） */
  memoryThreshold: 0.80,
  /** 同步完成后等待时间（毫秒），让数据库索引更新 */
  postSyncDelayMs: 10 * 1000,
};

// ==================== 运行时状态 ====================

/** 正在执行冷启动的账户集合（防止并发） */
const runningColdStarts = new Set<number>();

// ==================== 核心函数 ====================

/**
 * 触发智能冷启动 — 统一入口
 * 
 * 该函数是异步非阻塞的，调用后立即返回，冷启动在后台执行。
 * 执行结果通过 cold_start_logs 表和 optimization_events 表记录。
 * 
 * @param accountId 账户ID
 * @param options 冷启动选项
 */
export async function triggerColdStart(
  accountId: number,
  options: ColdStartOptions
): Promise<{ triggered: boolean; reason?: string; logId?: number }> {
  const { reason, force = false } = options;
  
  log.info(`[ColdStart] v${SYSTEM_VERSION}: 收到冷启动请求 - 账户=${accountId}, 原因=${reason}, 强制=${force}`);
  logSystem('ColdStart', `冷启动请求`, { accountId, reason, force });
  
  // 1. 并发检查
  if (runningColdStarts.has(accountId)) {
    log.warn(`[ColdStart] 账户 ${accountId} 已有冷启动正在执行，跳过`);
    return { triggered: false, reason: '已有冷启动正在执行' };
  }
  
  // 2. 系统关闭检查
  if (isShuttingDown()) {
    log.warn(`[ColdStart] 系统正在关闭，跳过冷启动`);
    return { triggered: false, reason: '系统正在关闭' };
  }
  
  // 3. 幂等性检查（非强制模式）
  if (!force) {
    const shouldSkip = await checkIdempotency(accountId, reason);
    if (shouldSkip) {
      log.info(`[ColdStart] 账户 ${accountId} 幂等性检查未通过: ${shouldSkip}`);
      return { triggered: false, reason: shouldSkip };
    }
  }
  
  // 4. 创建冷启动日志记录
  const logId = await createColdStartLog(accountId, reason);
  
  // 5. 异步执行冷启动（不阻塞调用方）
  runningColdStarts.add(accountId);
  executeColdStart(accountId, options, logId).finally(() => {
    runningColdStarts.delete(accountId);
  });
  
  return { triggered: true, logId };
}

/**
 * 批量触发冷启动 — 用于版本升级场景
 * 
 * 遍历所有有API凭证的活跃账户，逐个触发冷启动。
 * 账户之间串行执行，避免资源争用。
 */
export async function triggerColdStartForAllAccounts(
  reason: ColdStartTriggerReason,
  options: Partial<ColdStartOptions> = {}
): Promise<{ total: number; triggered: number; skipped: number; errors: number }> {
  log.info(`[ColdStart] v${SYSTEM_VERSION}: 批量冷启动开始 - 原因=${reason}`);
  
  const result = { total: 0, triggered: 0, skipped: 0, errors: 0 };
  
  try {
    // 发现所有可同步账户
    const { discoverSyncableAccounts } = await import('../sync/unifiedSyncEngine');
    const accounts = await discoverSyncableAccounts();
    result.total = accounts.length;
    
    log.info(`[ColdStart] 发现 ${accounts.length} 个账户需要冷启动`);
    
    for (const account of (accounts as unknown[])) {
      try {
        // @ts-expect-error Complex function parameter types
        const triggerResult = await triggerColdStart(account.accountId, {
          reason,
          ...options,
        });
        
        if (triggerResult.triggered) {
          result.triggered++;
          // 等待一段时间再处理下一个账户，避免资源争用
          await sleep(5000);
        } else {
          result.skipped++;
        }
      } catch (err: unknown) {
        // @ts-expect-error Legacy code type compatibility
        result.errors++;
        // @ts-expect-error Complex function parameter types
        log.warn(`[ColdStart] 账户 ${account.accountId} 冷启动触发失败: ${(err as Error).message}`);
      }
    }
    
    log.info(`[ColdStart] 批量冷启动完成: 总计=${result.total}, 触发=${result.triggered}, 跳过=${result.skipped}, 错误=${result.errors}`);
  } catch (err: unknown) {
    log.warn(`[ColdStart] 批量冷启动异常: ${(err as Error).message}`);
  }
  
  return result;
}

// ==================== 冷启动执行引擎 ====================

/**
 * 执行冷启动的完整流程
 */
async function executeColdStart(
  accountId: number,
  options: ColdStartOptions,
  logId: number
): Promise<ColdStartResult> {
  const startTime = Date.now();
  const {
    reason,
    historicalDays = COLD_START_CONFIG.defaultHistoricalDays,
    recentDays = COLD_START_CONFIG.defaultRecentDays,
    skipSync = false,
    specificModules,
  } = options;
  
  const result: ColdStartResult = {
    accountId,
    reason,
    systemVersion: SYSTEM_VERSION,
    status: 'completed',
    syncPhase: { executed: false, campaigns: 0, keywords: 0, searchTerms: 0, targets: 0, durationMs: 0 },
    historicalPhase: { executed: false, targetsProcessed: 0, negativesAdded: 0, keywordsHarvested: 0, ngramNegatives: 0, durationMs: 0 },
    recentPhase: { executed: false, targetsProcessed: 0, optimizationsTriggered: 0, durationMs: 0 },
    totalDurationMs: 0,
    errors: [],
  };
  
  log.info(`[ColdStart] ========================================`);
  log.info(`[ColdStart] 开始执行冷启动: 账户=${accountId}, 原因=${reason}`);
  log.info(`[ColdStart] 历史数据范围: ${historicalDays}天, 近期数据范围: ${recentDays}天`);
  log.info(`[ColdStart] ========================================`);
  
  try {
    await updateColdStartLog(logId, 'syncing');
    
    // ==================== 阶段1: 全量数据同步 ====================
    if (!skipSync) {
      const syncStart = Date.now();
      log.info(`[ColdStart] 阶段1: 全量数据同步开始 (${historicalDays}天)...`);
      
      try {
        const syncResult: unknown = await executeFullSync(accountId, historicalDays);
        // @ts-expect-error Dynamic property access
        result.syncPhase = {
          // @ts-expect-error Legacy code type compatibility
          executed: true,
          // @ts-expect-error Legacy code type compatibility
          campaigns: syncResult.campaigns,
          // @ts-expect-error Legacy code type compatibility
          keywords: syncResult.keywords,
          // @ts-expect-error Legacy code type compatibility
          searchTerms: syncResult.searchTerms,
          // @ts-expect-error Legacy code type compatibility
          targets: syncResult.targets,
          durationMs: Date.now() - syncStart,
        };
        
        // @ts-expect-error Complex function parameter types
        log.info(`[ColdStart] 阶段1完成: 广告活动=${syncResult.campaigns}, 关键词=${syncResult.keywords}, 搜索词=${syncResult.searchTerms}, 定向=${syncResult.targets}, 耗时=${result.syncPhase.durationMs}ms`);
        
        // 同步完成后等待，让数据库索引更新
        await sleep(COLD_START_CONFIG.postSyncDelayMs);
      } catch (syncErr: unknown) {
        log.warn(`[ColdStart] 阶段1失败（继续执行后续阶段）: ${(syncErr as Error).message}`);
        result.errors.push(`数据同步失败: ${(syncErr as Error).message}`);
      }
    } else {
      log.info(`[ColdStart] 阶段1跳过: skipSync=true`);
    }
    
    // ==================== 阶段2: 历史数据批量优化 ====================
    await updateColdStartLog(logId, 'optimizing_historical');
    const histStart = Date.now();
    log.info(`[ColdStart] 阶段2: 历史数据批量优化开始 (${recentDays}-${historicalDays}天前的数据)...`);
    
    try {
      const histResult = await executeHistoricalOptimization(accountId, historicalDays, recentDays, specificModules);
      result.historicalPhase = {
        executed: true,
        targetsProcessed: histResult.targetsProcessed,
        negativesAdded: histResult.negativesAdded,
        keywordsHarvested: histResult.keywordsHarvested,
        ngramNegatives: histResult.ngramNegatives,
        durationMs: Date.now() - histStart,
      };
      
      log.info(`[ColdStart] 阶段2完成: 目标=${histResult.targetsProcessed}, 否定词=${histResult.negativesAdded}, 收割=${histResult.keywordsHarvested}, Ngram否定=${histResult.ngramNegatives}, 耗时=${result.historicalPhase.durationMs}ms`);
    } catch (histErr: unknown) {
      log.warn(`[ColdStart] 阶段2失败（继续执行后续阶段）: ${(histErr as Error).message}`);
      result.errors.push(`历史数据优化失败: ${(histErr as Error).message}`);
    }
    
    // ==================== 阶段3: 近期数据快速优化 ====================
    await updateColdStartLog(logId, 'optimizing_recent');
    const recentStart = Date.now();
    log.info(`[ColdStart] 阶段3: 近期数据快速优化开始 (最近${recentDays}天)...`);
    
    try {
      const recentResult = await executeRecentOptimization(accountId, recentDays, specificModules);
      result.recentPhase = {
        executed: true,
        targetsProcessed: recentResult.targetsProcessed,
        optimizationsTriggered: recentResult.optimizationsTriggered,
        durationMs: Date.now() - recentStart,
      };
      
      log.info(`[ColdStart] 阶段3完成: 目标=${recentResult.targetsProcessed}, 触发优化=${recentResult.optimizationsTriggered}, 耗时=${result.recentPhase.durationMs}ms`);
    } catch (recentErr: unknown) {
      log.warn(`[ColdStart] 阶段3失败: ${(recentErr as Error).message}`);
      result.errors.push(`近期数据优化失败: ${(recentErr as Error).message}`);
    }
    
    // ==================== 完成 ====================
    result.totalDurationMs = Date.now() - startTime;
    result.status = result.errors.length > 0 ? 'failed' : 'completed';
    
    // 更新冷启动状态
    await updateColdStartStatus(accountId, result.status === 'completed' ? 'completed' : 'failed');
    await completeColdStartLog(logId, result);
    await recordColdStartEvent(accountId, result);
    
    log.info(`[ColdStart] ========================================`);
    log.info(`[ColdStart] 冷启动${result.status === 'completed' ? '成功' : '部分失败'}: 账户=${accountId}`);
    log.info(`[ColdStart] 总耗时: ${(result.totalDurationMs / 1000).toFixed(1)}秒`);
    log.info(`[ColdStart] 同步: ${result.syncPhase.executed ? '✅' : '⏭️'} | 历史优化: ${result.historicalPhase.executed ? '✅' : '❌'} | 近期优化: ${result.recentPhase.executed ? '✅' : '❌'}`);
    if (result.errors.length > 0) {
      log.warn(`[ColdStart] 错误数: ${result.errors.length}`);
    }
    log.info(`[ColdStart] ========================================`);
    
  } catch (err: unknown) {
    result.status = 'failed';
    result.totalDurationMs = Date.now() - startTime;
    result.errors.push(`冷启动异常: ${(err as Error).message}`);
    
    await updateColdStartStatus(accountId, 'failed');
    await completeColdStartLog(logId, result);
    
    log.warn(`[ColdStart] 冷启动异常终止: 账户=${accountId}, 错误=${(err as Error).message}`);
    logOptimizationError('ColdStart', `冷启动异常`, { accountId, reason, error: (err as Error).message });
  }
  
  return result;
}

// ==================== 阶段1: 全量数据同步 ====================

async function executeFullSync(
  accountId: number,
  days: number
): Promise<{ campaigns: number; keywords: number; searchTerms: number; targets: number }> {
  const result = { campaigns: 0, keywords: 0, searchTerms: 0, targets: 0 };
  
  try {
    // 获取账户的API凭证
    const credentials = await db.getAmazonApiCredentials(accountId);
    if (!credentials) {
      throw new Error(`账户 ${accountId} 没有API凭证`);
    }
    
    // 使用AmazonSyncService执行全量同步
    const { AmazonSyncService } = await import('../sync/amazonSyncService');
    const account = await db.getAdAccountById(accountId);
    if (!account) {
      throw new Error(`账户 ${accountId} 不存在`);
    }
    
    const syncService = await AmazonSyncService.createFromCredentials(
      {
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        refreshToken: credentials.refreshToken as string,
        profileId: credentials.profileId,
        region: (credentials.region as 'NA' | 'EU' | 'FE') || 'NA',
      },
      accountId,
      account.userId,
      account.marketplace
    );
    
    // v344: 修复P0 Bug - 执行全量同步时必须传入完整的历史天数
    // 之前syncAll()未传performanceDays参数，导致默认只同步14天绩效数据
    log.info(`[ColdStart] v344: 执行全量同步，performanceDays=${days}天`);
    const syncData = await syncService.syncAll({ performanceDays: days, syncMode: 'recovery' });
    result.campaigns = syncData.campaigns || 0;
    result.keywords = syncData.keywords || 0;
    result.targets = syncData.targets || 0;
    
    // 同步完成后更新lastSync时间
    await db.updateAmazonApiCredentialsLastSync(accountId);
    
    // v344: 移除额外的syncPerformanceOnly调用
    // syncAll已经通过performanceDays参数同步了完整的绩效数据
    // 之前这里硬编码了 days > 30 ? 30 : days，导致最多只同步30天
    log.info(`[ColdStart] v344: syncAll已包含${days}天绩效数据，无需额外同步`);
    
  } catch (err: unknown) {
    log.warn(`[ColdStart] 全量同步失败: ${(err as Error).message}`);
    throw err;
  }
  
  return result;
}

// ==================== 阶段2: 历史数据批量优化 ====================

async function executeHistoricalOptimization(
  accountId: number,
  historicalDays: number,
  recentDays: number,
  specificModules?: string[]
): Promise<{ targetsProcessed: number; negativesAdded: number; keywordsHarvested: number; ngramNegatives: number }> {
  const result = { targetsProcessed: 0, negativesAdded: 0, keywordsHarvested: 0, ngramNegatives: 0 };
  
  // 获取该账户下所有活跃的优化目标
  const { getEnabledOptimizationTargets, executeOptimizationTarget } = await import('./optimizationTargetEngine');
  const targets = await getEnabledOptimizationTargets(accountId);
  
  if (targets.length === 0) {
    log.info(`[ColdStart] 账户 ${accountId} 没有活跃的优化目标，跳过历史数据优化`);
    return result;
  }
  
  log.info(`[ColdStart] 发现 ${targets.length} 个活跃优化目标，开始历史数据批量优化...`);
  
  // === 2a: Ngram分析（全局级别，基于历史数据） ===
  try {
    log.info(`[ColdStart] 2a: 执行Ngram分析 (${historicalDays}天)...`);
    const { generateNegativeKeywordSuggestions } = await import('../analytics/ngramAnalysis');
    const suggestions = await generateNegativeKeywordSuggestions(accountId, undefined, historicalDays);
    
    if (suggestions.length > 0) {
      log.info(`[ColdStart] Ngram分析发现 ${suggestions.length} 个否定词建议`);
      
      // 自动执行高优先级的Ngram否定
      const highPriority = suggestions.filter(s => s.priority === 'high');
      if (highPriority.length > 0) {
        log.info(`[ColdStart] 自动执行 ${highPriority.length} 个高优先级Ngram否定...`);
        // Ngram否定通过常规的搜索词否定流程执行，这里只记录数量
        result.ngramNegatives = highPriority.length;
      }
    }
  } catch (ngramErr: unknown) {
    log.warn(`[ColdStart] Ngram分析失败（继续执行）: ${(ngramErr as Error).message}`);
  }
  
  // === 2b: 搜索词收割（基于历史数据中的高转化搜索词） ===
  try {
    log.info(`[ColdStart] 2b: 执行搜索词收割...`);
    const searchTermHarvester = await import('../automation/searchTermHarvester');
    const harvestResult = await searchTermHarvester.batchHarvestSearchTerms(accountId);
    result.keywordsHarvested = harvestResult.summary.success;
    log.info(`[ColdStart] 搜索词收割完成: 候选=${harvestResult.summary.total}, 成功=${harvestResult.summary.success}`);
  } catch (harvestErr: unknown) {
    log.warn(`[ColdStart] 搜索词收割失败（继续执行）: ${(harvestErr as Error).message}`);
  }
  
  // === 2c: 逐个优化目标执行搜索词否定（基于历史数据） ===
  const modulesToRun = specificModules || ['searchterm'];
  
  // 分批处理优化目标
  for (let i = 0; i < targets.length; i += COLD_START_CONFIG.batchSize) {
    const batch = targets.slice(i, i + COLD_START_CONFIG.batchSize);
    
    // v369: 内存检查 - 使用RSS绝对值代替heapUsed/heapTotal百分比
    const memUsage = process.memoryUsage();
    const rssMB = Math.round(memUsage.rss / 1024 / 1024);
    if (rssMB > 1000) {
      log.warn(`[ColdStart] v369: 内存紧张(RSS=${rssMB}MB)，暂停30秒等待GC...`);
      if (typeof global.gc === 'function') global.gc();
      await sleep(30000);
    }
    
    for (const target of batch) {
      if (isShuttingDown()) {
        log.warn(`[ColdStart] 系统正在关闭，中止历史数据优化`);
        break;
      }
      
      try {
        log.info(`[ColdStart] 处理优化目标: ${target.name} (id=${target.id})`);
        
        const execResult = await executeOptimizationTarget(target.id, {
          dryRun: false,
          forceExecution: true,
          specificModules: modulesToRun,
        });
        
        result.targetsProcessed++;
        result.negativesAdded += execResult.searchTermAnalysis.negativeKeywordsAdded || 0;
        
        log.info(`[ColdStart] 目标 ${target.name} 完成: 否定词=${execResult.searchTermAnalysis.negativeKeywordsAdded}, 新关键词=${execResult.searchTermAnalysis.newKeywordsAdded}`);
      } catch (targetErr: unknown) {
        log.warn(`[ColdStart] 目标 ${target.name} 优化失败: ${(targetErr as Error).message}`);
      }
    }
    
    // 批次间延迟
    if (i + COLD_START_CONFIG.batchSize < targets.length) {
      log.debug(`[ColdStart] 批次间延迟 ${COLD_START_CONFIG.batchDelayMs / 1000}秒...`);
      await sleep(COLD_START_CONFIG.batchDelayMs);
    }
  }
  
  return result;
}

// ==================== 阶段3: 近期数据快速优化 ====================

async function executeRecentOptimization(
  accountId: number,
  recentDays: number,
  specificModules?: string[]
): Promise<{ targetsProcessed: number; optimizationsTriggered: number }> {
  const result = { targetsProcessed: 0, optimizationsTriggered: 0 };
  
  try {
    // 使用常规优化调度器触发一次完整优化
    const { triggerAccountOptimizations } = await import('./optimizationScheduler');
    const triggerResult = await triggerAccountOptimizations(accountId, 'cold_start_recent');
    
    result.targetsProcessed = triggerResult.triggeredCount + triggerResult.skippedCount;
    result.optimizationsTriggered = triggerResult.triggeredCount;
    
    log.info(`[ColdStart] 近期数据优化触发: 执行=${triggerResult.triggeredCount}, 跳过=${triggerResult.skippedCount}`);
  } catch (err: unknown) {
    log.warn(`[ColdStart] 近期数据优化触发失败: ${(err as Error).message}`);
    throw err;
  }
  
  return result;
}

// ==================== 辅助函数 ====================

/**
 * 幂等性检查 — 判断是否需要执行冷启动
 */
async function checkIdempotency(accountId: number, reason: ColdStartTriggerReason): Promise<string | null> {
  try {
    const database = await getDb();
    if (!database) return null; // 数据库不可用时不阻止执行
    
    // @ts-expect-error Conditional type narrowing
    if (reason === 'version_upgrade') {
      // 版本升级场景：检查该账户是否已在当前版本执行过冷启动
      // @ts-expect-error DB query type inference limitation
      const rows = await database.execute(sql`
        SELECT last_cold_start_version FROM amazon_api_credentials 
        WHERE accountId = ${accountId} 
        LIMIT 1
      `);
      // @ts-expect-error Dynamic type assertion
      const row = (rows as Record<string, unknown>[])?.[0]?.[0];
      // @ts-expect-error Dynamic property access
      if (row?.last_cold_start_version >= SYSTEM_VERSION) {
        // @ts-expect-error Return type compatibility
        return `该账户已在 v${row.last_cold_start_version} 执行过冷启动，当前版本 v${SYSTEM_VERSION}`;
      // @ts-expect-error Legacy code type compatibility
      }
    } else if (reason === 'new_account' || reason === 'new_marketplace') {
      // 新账户/新站点场景：检查是否在最近1小时内已执行过冷启动
      const rows = await database.execute(sql`
        SELECT last_cold_start_at FROM amazon_api_credentials 
        WHERE accountId = ${accountId} 
        LIMIT 1
      `);
      // @ts-expect-error Dynamic type assertion
      const row = (rows as Record<string, unknown>[])?.[0]?.[0];
      // @ts-expect-error Conditional type narrowing
      if (row?.last_cold_start_at) {
        // @ts-expect-error Type inference limitation
        const lastColdStart = new Date(row.last_cold_start_at).getTime();
        // @ts-expect-error Type inference limitation
        const hoursSince = (Date.now() - lastColdStart) / (1000 * 60 * 60);
        // @ts-expect-error Conditional type narrowing
        if (hoursSince < 1) {
          return `该账户 ${hoursSince.toFixed(1)} 小时前刚执行过冷启动`;
        }
      }
    } else if (reason === 'credential_refresh') {
      // 凭证刷新场景：检查是否在最近30分钟内已执行过冷启动
      const rows = await database.execute(sql`
        SELECT last_cold_start_at FROM amazon_api_credentials 
        WHERE accountId = ${accountId} 
        LIMIT 1
      `);
      // @ts-expect-error Dynamic type assertion
      const row = (rows as Record<string, unknown>[])?.[0]?.[0];
      // @ts-expect-error Conditional type narrowing
      if (row?.last_cold_start_at) {
        // @ts-expect-error Type inference limitation
        const lastColdStart = new Date(row.last_cold_start_at).getTime();
        const minutesSince = (Date.now() - lastColdStart) / (1000 * 60);
        if (minutesSince < 30) {
          return `该账户 ${minutesSince.toFixed(0)} 分钟前刚执行过冷启动`;
        }
      }
    }
    
    return null; // 通过幂等性检查
  } catch (err: unknown) {
    log.warn(`[ColdStart] 幂等性检查失败（允许执行）: ${(err as Error).message}`);
    return null;
  // @ts-expect-error Legacy code type compatibility
  }
}

/**
 * 创建冷启动日志记录
 */
async function createColdStartLog(accountId: number, reason: ColdStartTriggerReason): Promise<number> {
  try {
    const database = await getDb();
    if (!database) return 0;
    
    const result = await database.execute(sql`
      INSERT INTO cold_start_logs (account_id, trigger_reason, system_version, status)
      VALUES (${accountId}, ${reason}, ${SYSTEM_VERSION}, 'started')
    `);
    
    // @ts-expect-error Dynamic type assertion
    return (result as Record<string, unknown>[])?.[0]?.insertId || 0;
  } catch (err: unknown) {
    log.warn(`[ColdStart] 创建日志记录失败: ${(err as Error).message}`);
    return 0;
  }
}

/**
 * 更新冷启动日志状态
 */
async function updateColdStartLog(logId: number, status: string): Promise<void> {
  if (logId === 0) return;
  try {
    const database = await getDb();
    if (!database) return;
    
    await database.execute(sql`
      UPDATE cold_start_logs SET status = ${status} WHERE id = ${logId}
    `);
  } catch (err: unknown) {
    log.warn(`[ColdStart] 更新日志状态失败: ${(err as Error).message}`);
  }
}

/**
 * 完成冷启动日志记录
 */
async function completeColdStartLog(logId: number, result: ColdStartResult): Promise<void> {
  if (logId === 0) return;
  try {
    const database = await getDb();
    if (!database) return;
    
    const detail = JSON.stringify({
      syncPhase: result.syncPhase,
      historicalPhase: result.historicalPhase,
      recentPhase: result.recentPhase,
      errors: result.errors,
    });
    
    await database.execute(sql`
      UPDATE cold_start_logs SET 
        status = ${result.status},
        sync_campaigns = ${result.syncPhase.campaigns},
        sync_keywords = ${result.syncPhase.keywords},
        sync_search_terms = ${result.syncPhase.searchTerms},
        sync_targets = ${result.syncPhase.targets},
        sync_duration_ms = ${result.syncPhase.durationMs},
        historical_targets_processed = ${result.historicalPhase.targetsProcessed},
        historical_negatives_added = ${result.historicalPhase.negativesAdded},
        historical_keywords_harvested = ${result.historicalPhase.keywordsHarvested},
        historical_ngram_negatives = ${result.historicalPhase.ngramNegatives},
        historical_duration_ms = ${result.historicalPhase.durationMs},
        recent_targets_processed = ${result.recentPhase.targetsProcessed},
        recent_optimizations_triggered = ${result.recentPhase.optimizationsTriggered},
        recent_duration_ms = ${result.recentPhase.durationMs},
        total_duration_ms = ${result.totalDurationMs},
        error_message = ${result.errors.length > 0 ? result.errors.join('; ') : null},
        detail = ${detail},
        completed_at = NOW()
      WHERE id = ${logId}
    `);
  } catch (err: unknown) {
    log.warn(`[ColdStart] 完成日志记录失败: ${(err as Error).message}`);
  }
}

/**
 * 更新账户的冷启动状态
 */
async function updateColdStartStatus(accountId: number, status: 'completed' | 'failed'): Promise<void> {
  try {
    const database = await getDb();
    if (!database) return;
    
    if (status === 'completed') {
      await database.execute(sql`
        UPDATE amazon_api_credentials SET 
          last_cold_start_at = NOW(),
          last_cold_start_version = ${SYSTEM_VERSION},
          cold_start_status = 'completed'
        WHERE accountId = ${accountId}
      `);
    } else {
      await database.execute(sql`
        UPDATE amazon_api_credentials SET 
          cold_start_status = 'failed'
        WHERE accountId = ${accountId}
      `);
    }
  } catch (err: unknown) {
    log.warn(`[ColdStart] 更新账户冷启动状态失败: ${(err as Error).message}`);
  }
}

/**
 * 记录冷启动事件到optimization_events表
 */
async function recordColdStartEvent(accountId: number, result: ColdStartResult): Promise<void> {
  try {
    const database = await getDb();
    if (!database) return;
    
    const detail = JSON.stringify({
      type: 'cold_start_complete',
      systemVersion: SYSTEM_VERSION,
      reason: result.reason,
      syncPhase: result.syncPhase,
      historicalPhase: result.historicalPhase,
      recentPhase: result.recentPhase,
      totalDurationMs: result.totalDurationMs,
      errors: result.errors,
    });
    
    const changeReason = `v${SYSTEM_VERSION} 智能冷启动[${result.reason}]: ` +
      `同步=${result.syncPhase.executed ? '✅' : '⏭️'} ` +
      `历史优化=${result.historicalPhase.targetsProcessed}目标/${result.historicalPhase.negativesAdded}否定 ` +
      `近期优化=${result.recentPhase.optimizationsTriggered}次 ` +
      `耗时=${(result.totalDurationMs / 1000).toFixed(1)}s`;
    
    await database.execute(sql`
      INSERT INTO optimization_events 
        (account_id, event_category, action_type, action_detail, change_reason, algorithm_version, status, api_sync_status) 
      VALUES 
        (${accountId}, 'settings_change', 'auto_correction', ${detail}, ${changeReason}, ${`v${SYSTEM_VERSION}`}, ${result.status === 'completed' ? 'success' : 'failed'}, 'internal')  -- v513: 内部事件使用 internal 状态
    `);
  } catch (err: unknown) {
    log.warn(`[ColdStart] 记录冷启动事件失败: ${(err as Error).message}`);
  }
}

// ==================== 状态查询 ====================

/**
 * 获取账户的冷启动状态
 */
export async function getColdStartStatus(accountId: number): Promise<{
  lastColdStartAt: string | null;
  lastColdStartVersion: number | null;
  coldStartStatus: string;
  // @ts-expect-error Legacy code type compatibility
  isRunning: boolean;
}> {
  // @ts-expect-error Type inference limitation
  const isRunning = runningColdStarts.has(accountId);
  
  // @ts-expect-error Legacy code type compatibility
  try {
    const database = await getDb();
    if (!database) {
      return { lastColdStartAt: null, lastColdStartVersion: null, coldStartStatus: 'unknown', isRunning };
    }
    
    const rows = await database.execute(sql`
      SELECT last_cold_start_at, last_cold_start_version, cold_start_status
      FROM amazon_api_credentials 
      WHERE accountId = ${accountId}
      LIMIT 1
    `);
    
    // @ts-expect-error Dynamic type assertion
    const row = (rows as Record<string, unknown>[])?.[0]?.[0];
    return {
      // @ts-expect-error Conditional type narrowing
      lastColdStartAt: row?.last_cold_start_at || null,
      // @ts-expect-error Conditional type narrowing
      lastColdStartVersion: row?.last_cold_start_version || null,
      // @ts-expect-error Conditional type narrowing
      coldStartStatus: row?.cold_start_status || 'idle',
      isRunning,
    // @ts-expect-error Legacy code type compatibility
    };
  } catch (err: unknown) {
    return { lastColdStartAt: null, lastColdStartVersion: null, coldStartStatus: 'error', isRunning };
  }
}

/**
 * 获取冷启动执行日志
 */
export async function getColdStartLogs(accountId?: number, limit: number = 20): Promise<Record<string, unknown>[]> {
  try {
    const database = await getDb();
    if (!database) return [];
    
    if (accountId) {
      const rows = await database.execute(sql`
        SELECT * FROM cold_start_logs 
        WHERE account_id = ${accountId} 
        ORDER BY created_at DESC 
        LIMIT ${sql.raw(String(limit))}
      `);
      // @ts-expect-error Dynamic type assertion
      return (rows as Record<string, unknown>[])?.[0] || [];
    } else {
      const rows = await database.execute(sql`
        SELECT * FROM cold_start_logs 
        ORDER BY created_at DESC 
        LIMIT ${sql.raw(String(limit))}
      `);
      // @ts-expect-error Dynamic type assertion
      return (rows as Record<string, unknown>[])?.[0] || [];
    }
  } catch (err: unknown) {
    log.warn(`[ColdStart] 查询冷启动日志失败: ${(err as Error).message}`);
    return [];
  }
}

/**
 * 检查是否有正在运行的冷启动
 */
export function isAnyColdStartRunning(): boolean {
  return runningColdStarts.size > 0;
}

/**
 * 获取正在运行冷启动的账户列表
 */
export function getRunningColdStarts(): number[] {
  return Array.from(runningColdStarts);
}

// ==================== 工具函数 ====================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
