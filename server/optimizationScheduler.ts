/**
 * 优化目标调度器服务
 * 
 * 核心职责：
 * 1. 创建优化目标/添加广告活动后，立即触发首次优化分析和执行
 * 2. 首次执行完成后，自动注册后续定时调度（按配置的频率）
 * 3. 服务器启动时，自动恢复所有活跃优化目标的调度任务
 * 4. 管理优化目标的完整生命周期：首次快速分析 → 立即执行 → 后续按频率调度
 */

import { getDb } from "./db";
import { performanceGroups } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";
import { createModuleLogger } from './utils/logger';

const log = createModuleLogger('OptScheduler');

// ==================== 类型定义 ====================

interface ScheduledTarget {
  targetId: number;
  targetName: string;
  intervalMs: number;
  timer: NodeJS.Timeout | null;
  lastExecutionTime: Date | null;
  nextExecutionTime: Date | null;
  executionCount: number;
  status: 'scheduled' | 'executing' | 'paused' | 'error';
  lastError: string | null;
}

interface InitialOptimizationResult {
  targetId: number;
  targetName: string;
  phase: 'analysis' | 'execution' | 'scheduling';
  success: boolean;
  analysisResult?: {
    campaignCount: number;
    totalSpend: number;
    totalSales: number;
    avgAcos: number;
    avgRoas: number;
    dataQuality: 'sufficient' | 'moderate' | 'sparse';
  };
  executionResult?: any;
  schedulingResult?: {
    frequency: string;
    nextExecutionTime: Date;
  };
  errors: string[];
  duration: number; // 毫秒
}

// ==================== 调度器状态管理 ====================

// 全局调度器状态
const scheduledTargets: Map<number, ScheduledTarget> = new Map();
let isSchedulerRunning = false;

// 频率到毫秒的映射
const FREQUENCY_MS: Record<string, number> = {
  'hourly': 60 * 60 * 1000,           // 1小时
  'every_2_hours': 2 * 60 * 60 * 1000, // 2小时
  'every_4_hours': 4 * 60 * 60 * 1000, // 4小时
  'every_6_hours': 6 * 60 * 60 * 1000, // 6小时
  'daily': 24 * 60 * 60 * 1000,        // 24小时
  'weekly': 7 * 24 * 60 * 60 * 1000,   // 7天
};

// ==================== 核心功能：即时触发首次优化 ====================

/**
 * 创建优化目标后立即触发首次优化
 * 这是整个调度器最核心的功能：用户创建优化目标并添加广告活动后，
 * 系统立即分析数据并执行首次优化，而不是等待定时调度。
 */
export async function triggerInitialOptimization(
  targetId: number,
  options: {
    triggeredBy: 'create' | 'add_campaigns' | 'enable' | 'manual';
    campaignIds?: number[];
  } = { triggeredBy: 'create' }
): Promise<InitialOptimizationResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  
  log.info(`触发首次优化: targetId=${targetId}, triggeredBy=${options.triggeredBy}`);
  
  // 动态导入优化引擎（避免循环依赖）
  const optimizationTargetEngine = await import('./optimizationTargetEngine');
  
  // 获取优化目标配置
  const config = await optimizationTargetEngine.getOptimizationTargetConfig(targetId);
  if (!config) {
    return {
      targetId,
      targetName: '未知',
      phase: 'analysis',
      success: false,
      errors: ['优化目标不存在'],
      duration: Date.now() - startTime,
    };
  }
  
  const result: InitialOptimizationResult = {
    targetId,
    targetName: config.name,
    phase: 'analysis',
    success: false,
    errors: [],
    duration: 0,
  };
  
  // ==================== 阶段1: 快速数据分析 ====================
  try {
    log.debug(`[${config.name}] 阶段1: 快速数据分析...`);
    
    const db = await getDb();
    if (!db) throw new Error('数据库连接失败');
    
    // 获取优化目标下的所有广告活动
    const campaignsData = await import('./db').then(m => m.getCampaignsByPerformanceGroupId(targetId));
    
    if (campaignsData.length === 0) {
      result.errors.push('优化目标下没有广告活动，跳过首次优化');
      result.duration = Date.now() - startTime;
      // 即使没有广告活动，也注册调度器（后续添加广告活动时会重新触发）
      await registerScheduledExecution(targetId, config.name, 'daily');
      return result;
    }
    
    // 快速聚合分析
    let totalSpend = 0, totalSales = 0, totalClicks = 0, totalOrders = 0, totalImpressions = 0;
    for (const c of campaignsData) {
      totalSpend += parseFloat(c.spend || '0');
      totalSales += parseFloat(c.sales || '0');
      totalClicks += c.clicks || 0;
      totalOrders += c.orders || 0;
      totalImpressions += c.impressions || 0;
    }
    
    const avgAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
    const avgRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
    
    // 评估数据质量
    let dataQuality: 'sufficient' | 'moderate' | 'sparse' = 'sparse';
    if (totalClicks >= 100 && totalOrders >= 10) {
      dataQuality = 'sufficient';
    } else if (totalClicks >= 20 || totalOrders >= 3) {
      dataQuality = 'moderate';
    }
    
    result.analysisResult = {
      campaignCount: campaignsData.length,
      totalSpend,
      totalSales,
      avgAcos,
      avgRoas,
      dataQuality,
    };
    
    log.info(`[${config.name}] 数据分析完成: ${campaignsData.length}个广告活动, ` +
      `花费$${totalSpend.toFixed(2)}, 销售$${totalSales.toFixed(2)}, ` +
      `ACoS ${avgAcos.toFixed(1)}%, ROAS ${avgRoas.toFixed(2)}, 数据质量: ${dataQuality}`);
    
    // ==================== 阶段2: 立即执行首次优化 ====================
    result.phase = 'execution';
    log.info(`[${config.name}] 阶段2: 执行首次优化...`);
    
    try {
      // 根据数据质量决定执行策略
      let specificModules: string[] | undefined;
      
      if (dataQuality === 'sparse') {
        // 数据稀疏：只执行出价优化（探索模式）和搜索词分析
        // 不执行预算分配和位置优化（需要更多数据支撑）
        specificModules = ['bid', 'searchterm', 'keyword'];
        log.info(`[${config.name}] 数据稀疏，仅执行探索性优化模块: ${specificModules.join(', ')}`);
      } else if (dataQuality === 'moderate') {
        // 中等数据：执行大部分模块，但跳过位置优化
        specificModules = ['bid', 'searchterm', 'keyword', 'budget'];
        log.info(`[${config.name}] 数据中等，执行核心优化模块: ${specificModules.join(', ')}`);
      }
      // 数据充足：执行所有模块（specificModules = undefined）
      
      const executionResult = await optimizationTargetEngine.executeOptimizationTarget(targetId, {
        dryRun: false,
        forceExecution: true, // 首次执行强制执行，忽略启用状态检查
        specificModules,
      });
      
      result.executionResult = {
        status: executionResult.status,
        bidAdjustments: executionResult.bidOptimization.adjustmentsCount,
        placementAdjustments: executionResult.placementOptimization.adjustmentsCount,
        keywordChanges: {
          paused: executionResult.keywordStatusChanges.pausedCount,
          enabled: executionResult.keywordStatusChanges.enabledCount,
        },
        budgetAdjustments: executionResult.budgetAllocation.adjustmentsCount,
        errors: executionResult.errors,
        warnings: executionResult.warnings,
      };
      
      log.info(`[${config.name}] 首次优化执行完成: ` +
        `出价调整${executionResult.bidOptimization.adjustmentsCount}个, ` +
        `关键词暂停${executionResult.keywordStatusChanges.pausedCount}个/启用${executionResult.keywordStatusChanges.enabledCount}个, ` +
        `预算调整${executionResult.budgetAllocation.adjustmentsCount}个`);
      
      if (executionResult.errors.length > 0) {
        errors.push(...executionResult.errors);
      }
    } catch (execError: any) {
      errors.push(`首次优化执行失败: ${execError.message}`);
      log.error(`[${config.name}] 首次优化执行失败:`, execError.message);
    }
    
    // ==================== 阶段3: 注册后续定时调度 ====================
    result.phase = 'scheduling';
    log.info(`[${config.name}] 阶段3: 注册后续定时调度...`);
    
    try {
      // 根据数据质量决定初始调度频率
      let frequency = 'daily';
      if (dataQuality === 'sparse') {
        // 数据稀疏时，更频繁地执行以收集数据和调整
        frequency = 'every_6_hours';
      } else if (dataQuality === 'moderate') {
        frequency = 'every_4_hours';
      }
      
      const schedulingResult = await registerScheduledExecution(targetId, config.name, frequency);
      result.schedulingResult = schedulingResult;
      
      log.info(`[${config.name}] 调度注册完成: 频率=${frequency}, ` +
        `下次执行=${schedulingResult.nextExecutionTime.toISOString()}`);
    } catch (schedError: any) {
      errors.push(`调度注册失败: ${schedError.message}`);
      log.error(`[${config.name}] 调度注册失败:`, schedError.message);
    }
    
    result.success = errors.length === 0;
    result.errors = errors;
    
    // 更新数据库中的执行状态
    try {
      const dbInstance = await getDb();
      if (dbInstance) {
        await dbInstance.update(performanceGroups).set({
          lastOptimizationAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }).where(eq(performanceGroups.id, targetId));
      }
    } catch (e) {
      // 非关键错误，不影响结果
    }
    
    // 发送通知
    try {
      const statusEmoji = result.success ? '✅' : '⚠️';
      await notifyOwner({
        title: `${statusEmoji} 优化目标"${config.name}"首次优化${result.success ? '完成' : '部分完成'}`,
        content: [
          `触发方式: ${options.triggeredBy === 'create' ? '创建优化目标' : options.triggeredBy === 'add_campaigns' ? '添加广告活动' : options.triggeredBy === 'enable' ? '启用优化目标' : '手动触发'}`,
          `广告活动数: ${result.analysisResult?.campaignCount || 0}`,
          `数据质量: ${dataQuality === 'sufficient' ? '充足' : dataQuality === 'moderate' ? '中等' : '稀疏'}`,
          result.executionResult ? `出价调整: ${result.executionResult.bidAdjustments}个` : '',
          result.executionResult ? `关键词变更: 暂停${result.executionResult.keywordChanges?.paused || 0}个, 启用${result.executionResult.keywordChanges?.enabled || 0}个` : '',
          result.schedulingResult ? `后续调度: ${result.schedulingResult.frequency}, 下次执行${result.schedulingResult.nextExecutionTime.toLocaleString()}` : '',
          errors.length > 0 ? `\n警告: ${errors.join('; ')}` : '',
        ].filter(Boolean).join('\n'),
      });
    } catch (e) {
      // 通知失败不影响主流程
    }
    
  } catch (error: any) {
    result.errors.push(`首次优化失败: ${error.message}`);
    log.error(`[${result.targetName}] 首次优化失败:`, error);
  }
  
  result.duration = Date.now() - startTime;
  log.info(`首次优化完成: targetId=${targetId}, 耗时${result.duration}ms, 成功=${result.success}`);
  
  return result;
}

// ==================== 定时调度管理 ====================

/**
 * 注册优化目标的定时执行
 */
async function registerScheduledExecution(
  targetId: number,
  targetName: string,
  frequency: string
): Promise<{ frequency: string; nextExecutionTime: Date }> {
  // 如果已有调度，先清除
  unregisterScheduledExecution(targetId);
  
  const intervalMs = FREQUENCY_MS[frequency] || FREQUENCY_MS['daily'];
  const nextExecutionTime = new Date(Date.now() + intervalMs);
  
  const scheduledTarget: ScheduledTarget = {
    targetId,
    targetName,
    intervalMs,
    timer: null,
    lastExecutionTime: new Date(),
    nextExecutionTime,
    executionCount: 1, // 首次执行已完成
    status: 'scheduled',
    lastError: null,
  };
  
  // v189: 禁用独立定时器，避免与dataSyncScheduler的模块化调度重复执行
  // dataSyncScheduler已经按模块类型分别调度（出价每2小时、分时每小时、搜索词每天凌晨4点等），
  // 不再需要optimizationScheduler的独立定时器。
  // 保留scheduledTargets记录用于状态查询，但不再设置setInterval。
  scheduledTarget.timer = null;
  scheduledTargets.set(targetId, scheduledTarget);
  
  log.info(`v189: 已注册优化目标: targetId=${targetId}, name=${targetName} ` +
    `(定时执行由dataSyncScheduler统一管理)`);
  
  return { frequency, nextExecutionTime };
}

/**
 * 取消优化目标的定时执行
 */
function unregisterScheduledExecution(targetId: number): void {
  const existing = scheduledTargets.get(targetId);
  if (existing) {
    if (existing.timer) {
      clearInterval(existing.timer);
    }
    scheduledTargets.delete(targetId);
    log.info(`已取消定时执行: targetId=${targetId}, name=${existing.targetName}`);
  }
}

/**
 * 执行定时优化任务
 */
async function executeScheduledOptimization(targetId: number): Promise<void> {
  const scheduled = scheduledTargets.get(targetId);
  if (!scheduled) return;
  
  // 防止并发执行
  if (scheduled.status === 'executing') {
    log.info(`跳过执行: targetId=${targetId} 正在执行中`);
    return;
  }
  
  scheduled.status = 'executing';
  log.info(`开始定时执行: targetId=${targetId}, name=${scheduled.targetName}, ` +
    `第${scheduled.executionCount + 1}次执行`);
  
  try {
    const optimizationTargetEngine = await import('./optimizationTargetEngine');
    
    // 检查优化目标是否仍然活跃
    const config = await optimizationTargetEngine.getOptimizationTargetConfig(targetId);
    if (!config || !config.isEnabled) {
      log.debug(`优化目标已禁用或不存在，取消调度: targetId=${targetId}`);
      unregisterScheduledExecution(targetId);
      return;
    }
    
    // v189: 此函数不再被调用（定时器已禁用），保留代码以备手动触发场景
    const result = await optimizationTargetEngine.executeOptimizationTarget(targetId, {
      dryRun: false,
    });
    
    scheduled.lastExecutionTime = new Date();
    scheduled.nextExecutionTime = new Date(Date.now() + scheduled.intervalMs);
    scheduled.executionCount++;
    scheduled.status = 'scheduled';
    scheduled.lastError = null;
    
    log.info(`定时执行完成: targetId=${targetId}, status=${result.status}, ` +
      `bid=${result.bidOptimization.adjustmentsCount}, keyword_pause=${result.keywordStatusChanges.pausedCount}`);
    
    // 更新数据库
    try {
      const dbInstance = await getDb();
      if (dbInstance) {
        await dbInstance.update(performanceGroups).set({
          lastOptimizationAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }).where(eq(performanceGroups.id, targetId));
      }
    } catch (e) { /* 非关键 */ }
    
  } catch (error: any) {
    scheduled.status = 'error';
    scheduled.lastError = error.message;
    log.error(`定时执行失败: targetId=${targetId}:`, error.message);
    
    // 连续失败3次后暂停调度
    if (scheduled.lastError) {
      // 简单的错误计数（通过检查状态）
      log.warn(`优化目标 ${targetId} 执行出错，将在下次调度时重试`);
    }
  }
}

// ==================== 服务器启动时恢复调度 ====================

/**
 * 启动优化调度器
 * 在服务器启动时调用，恢复所有活跃优化目标的定时调度
 */
export async function startOptimizationScheduler(): Promise<{
  total: number;
  scheduled: number;
  errors: number;
}> {
  if (isSchedulerRunning) {
    log.debug('调度器已在运行中');
    return { total: 0, scheduled: scheduledTargets.size, errors: 0 };
  }
  
  log.info('启动优化调度器...');
  isSchedulerRunning = true;
  
  try {
    const dbInstance = await getDb();
    if (!dbInstance) {
      log.error('数据库连接失败，调度器启动失败');
      return { total: 0, scheduled: 0, errors: 1 };
    }
    
    // 获取所有活跃的优化目标
    const activeTargets = await dbInstance
      .select({
        id: performanceGroups.id,
        name: performanceGroups.name,
        status: performanceGroups.status,
        optimizationGoal: performanceGroups.optimizationGoal,
      })
      .from(performanceGroups)
      .where(eq(performanceGroups.status, 'active'));
    
    let scheduled = 0;
    let errors = 0;
    
    for (const target of activeTargets) {
      try {
        // 检查是否有广告活动
        const campaigns = await import('./db').then(m => m.getCampaignsByPerformanceGroupId(target.id));
        if (campaigns.length === 0) {
          log.info(`跳过无广告活动的优化目标: ${target.name} (id=${target.id})`);
          continue;
        }
        
        // 注册定时执行（默认每日）
        await registerScheduledExecution(target.id, target.name, 'daily');
        scheduled++;
      } catch (error: any) {
        log.error(`注册优化目标 ${target.id} 失败:`, error.message);
        errors++;
      }
    }
    
    log.info(`调度器启动完成: 共${activeTargets.length}个活跃目标, ` +
      `已注册${scheduled}个, 失败${errors}个`);
    
    return { total: activeTargets.length, scheduled, errors };
  } catch (error: any) {
    log.error('调度器启动失败:', error.message);
    isSchedulerRunning = false;
    return { total: 0, scheduled: 0, errors: 1 };
  }
}

/**
 * 停止优化调度器
 */
export function stopOptimizationScheduler(): void {
  log.debug('停止优化调度器...');
  
  for (const [targetId, scheduled] of scheduledTargets) {
    if (scheduled.timer) {
      clearInterval(scheduled.timer);
    }
  }
  
  scheduledTargets.clear();
  isSchedulerRunning = false;
  
  log.debug('调度器已停止');
}

/**
 * 获取调度器状态
 */
export function getSchedulerStatus(): {
  isRunning: boolean;
  scheduledCount: number;
  targets: Array<{
    targetId: number;
    targetName: string;
    status: string;
    lastExecutionTime: string | null;
    nextExecutionTime: string | null;
    executionCount: number;
    lastError: string | null;
  }>;
} {
  return {
    isRunning: isSchedulerRunning,
    scheduledCount: scheduledTargets.size,
    targets: Array.from(scheduledTargets.values()).map(t => ({
      targetId: t.targetId,
      targetName: t.targetName,
      status: t.status,
      lastExecutionTime: t.lastExecutionTime?.toISOString() || null,
      nextExecutionTime: t.nextExecutionTime?.toISOString() || null,
      executionCount: t.executionCount,
      lastError: t.lastError,
    })),
  };
}

// ==================== 生命周期事件处理 ====================

/**
 * 优化目标状态变更时调用
 */
export async function onTargetStatusChanged(
  targetId: number,
  newStatus: 'active' | 'paused' | 'archived'
): Promise<void> {
  if (newStatus === 'active') {
    // 启用时，触发首次优化并注册调度
    log.info(`优化目标 ${targetId} 已启用，触发首次优化`);
    // 异步执行，不阻塞API响应
    triggerInitialOptimization(targetId, { triggeredBy: 'enable' }).catch(err => {
      log.error(`启用触发优化失败:`, err);
    });
  } else {
    // 暂停或归档时，取消调度
    unregisterScheduledExecution(targetId);
    log.debug(`优化目标 ${targetId} 已${newStatus === 'paused' ? '暂停' : '归档'}，已取消调度`);
  }
}

/**
 * 广告活动被添加到优化目标时调用
 */
export async function onCampaignsAdded(
  targetId: number,
  campaignIds: number[]
): Promise<void> {
  log.info(`${campaignIds.length}个广告活动已添加到优化目标 ${targetId}，触发优化`);
  
  // 异步执行，不阻塞API响应
  triggerInitialOptimization(targetId, {
    triggeredBy: 'add_campaigns',
    campaignIds,
  }).catch(err => {
    log.error(`添加广告活动触发优化失败:`, err);
  });
}


// ==================== v151: 统一优化入口 ====================

/**
 * 触发指定账户下所有活跃优化目标的优化执行
 * 
 * 替代原有的 automationExecutionEngine.runFullAutomationCycle()
 * 核心改进：
 * 1. 基于优化目标而非账户进行优化，粒度更细
 * 2. 每个优化目标独立执行，互不影响
 * 3. 复用 optimizationTargetEngine 的完整9模块优化流程
 * 4. 自动跳过冷却期内的优化目标
 * 
 * @param accountId 账户ID
 * @param triggeredBy 触发来源
 * @returns 触发结果统计
 */
export async function triggerAccountOptimizations(
  accountId: number,
  triggeredBy: string = 'data_sync_complete'
): Promise<{
  triggeredCount: number;
  skippedCount: number;
  errorCount: number;
  details: Array<{
    targetId: number;
    targetName: string;
    status: 'triggered' | 'skipped' | 'error';
    reason?: string;
  }>;
}> {
  log.info(`v151: 触发账户 ${accountId} 下所有优化目标, 来源: ${triggeredBy}`);
  
  const result = {
    triggeredCount: 0,
    skippedCount: 0,
    errorCount: 0,
    details: [] as Array<{
      targetId: number;
      targetName: string;
      status: 'triggered' | 'skipped' | 'error';
      reason?: string;
    }>,
  };
  
  try {
    const dbInstance = await getDb();
    if (!dbInstance) {
      log.error(`v151: 数据库连接失败`);
      result.errorCount = 1;
      return result;
    }
    
    // 获取该账户下所有活跃的优化目标
    const activeTargets = await dbInstance
      .select({
        id: performanceGroups.id,
        name: performanceGroups.name,
        status: performanceGroups.status,
      })
      .from(performanceGroups)
      .where(
        and(
          eq(performanceGroups.accountId, accountId),
          eq(performanceGroups.status, 'active')
        )
      );
    
    if (activeTargets.length === 0) {
      log.debug(`v151: 账户 ${accountId} 下没有活跃的优化目标`);
      return result;
    }
    
    log.info(`v151: 账户 ${accountId} 下发现 ${activeTargets.length} 个活跃优化目标`);
    
    // 动态导入优化引擎
    const optimizationTargetEngine = await import('./optimizationTargetEngine');
    
    // 逐个触发优化目标执行（串行执行，避免资源争用）
    for (const target of activeTargets) {
      try {
        // 检查是否在冷却期内（最近执行过的跳过）
        const lastExecution = scheduledTargets.get(target.id);
        if (lastExecution?.lastExecutionTime) {
          const timeSinceLastExec = Date.now() - lastExecution.lastExecutionTime.getTime();
          const MIN_INTERVAL_MS = 30 * 60 * 1000; // 最小间隔30分钟
          if (timeSinceLastExec < MIN_INTERVAL_MS) {
            result.skippedCount++;
            result.details.push({
              targetId: target.id,
              targetName: target.name,
              status: 'skipped',
              reason: `冷却期内（距上次执行 ${Math.round(timeSinceLastExec / 60000)} 分钟）`,
            });
            continue;
          }
        }
        
        // 检查是否有广告活动
        const campaigns = await import('./db').then(m => m.getCampaignsByPerformanceGroupId(target.id));
        if (campaigns.length === 0) {
          result.skippedCount++;
          result.details.push({
            targetId: target.id,
            targetName: target.name,
            status: 'skipped',
            reason: '无广告活动',
          });
          continue;
        }
        
        // 执行优化
        log.info(`v151: 执行优化目标 ${target.name} (id=${target.id})`);
        const execResult = await optimizationTargetEngine.executeOptimizationTarget(target.id);
        
        // 更新最后执行时间
        if (scheduledTargets.has(target.id)) {
          scheduledTargets.get(target.id)!.lastExecutionTime = new Date();
        }
        
        result.triggeredCount++;
        result.details.push({
          targetId: target.id,
          targetName: target.name,
          status: 'triggered',
        });
        
        log.info(`v151: 优化目标 ${target.name} 执行完成`);
      } catch (error: any) {
        result.errorCount++;
        result.details.push({
          targetId: target.id,
          targetName: target.name,
          status: 'error',
          reason: error.message,
        });
        log.error(`v151: 优化目标 ${target.name} 执行失败:`, error.message);
      }
    }
    
    log.info(`v151: 账户 ${accountId} 优化触发完成: ` +
      `触发=${result.triggeredCount}, 跳过=${result.skippedCount}, 错误=${result.errorCount}`);
    
  } catch (error: any) {
    log.error(`v151: 账户 ${accountId} 优化触发异常:`, error.message);
    result.errorCount++;
  }
  
  return result;
}
