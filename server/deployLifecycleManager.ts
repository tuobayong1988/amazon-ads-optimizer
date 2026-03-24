/**
 * DeployLifecycleManager v185
 * 
 * 部署生命周期管理器 — 保障广告优化系统在版本更新时的工作连续性和正确性。
 * 
 * 核心职责:
 * 1. 优雅关闭 (Graceful Shutdown):
 *    - 捕获 SIGTERM/SIGINT 信号
 *    - 停止接收新任务（调度器、SQS消费者）
 *    - 等待当前正在执行的优化操作完成（最多25秒）
 *    - 将系统状态持久化到数据库
 *    - 安全关闭数据库连接
 * 
 * 2. 任务状态持久化与恢复:
 *    - 关闭前记录"正在执行"的任务状态
 *    - 新版本启动时检测并恢复中断的任务
 *    - 将 optimization_tasks 中 status='processing' 的任务重置为 'pending'
 * 
 * 3. 启动协调 (Startup Orchestration):
 *    - 检测上次关闭是否正常（graceful vs crash）
 *    - 按正确顺序启动各子系统
 *    - 恢复中断的任务 → 纠错扫描 → 版本检测重优化 → 常规调度
 * 
 * 4. 部署心跳:
 *    - 定期写入心跳时间戳到数据库
 *    - 新版本启动时通过心跳时间差判断上次关闭类型
 * 
 * 与 EB 部署的配合:
 *    - EB 发送 SIGTERM → 优雅关闭（25秒内完成）
 *    - EB 等待30秒后强制 SIGKILL（我们在25秒内完成，留5秒缓冲）
 *    - 新实例启动 → 启动协调器接管
 */

import { getDb } from './db';
import { optimizationEvents } from '../drizzle/schema';
import { sql, eq, and, desc } from 'drizzle-orm';
import { stopDataSyncScheduler, stopOptimizationScheduler } from './sync/dataSyncScheduler';
import { stopSQSConsumer } from './sync/sqsConsumerService';
import { stopEffectTrackingScheduler } from './scheduler/effectTrackingScheduler';
import { SYSTEM_VERSION } from './utils/systemVersion';
import { reportJobScheduler } from './services/reportJobScheduler';
import { createModuleLogger } from './utils/logger';

const log = createModuleLogger('DeployLifecycle');

// ==================== 类型定义 ====================

interface ShutdownState {
  isShuttingDown: boolean;
  shutdownStartedAt: Date | null;
  shutdownReason: string;
  activeTaskCount: number;
}

interface SystemHeartbeat {
  version: number;
  timestamp: string;
  shutdownType: 'graceful' | 'crash' | 'unknown';
  activeTargets: number;
  pendingTasks: number;
}

interface StartupDiagnostics {
  lastShutdownType: 'graceful' | 'crash' | 'unknown';
  lastHeartbeatAge: number; // 上次心跳距今的秒数
  interruptedTasks: number; // 被中断的processing任务数
  pendingTasks: number; // 待处理的pending任务数
  versionChanged: boolean;
  previousVersion: number | null;
  currentVersion: number;
}

// ==================== 全局状态 ====================

const shutdownState: ShutdownState = {
  isShuttingDown: false,
  shutdownStartedAt: null,
  shutdownReason: '',
  activeTaskCount: 0,
};

// 活跃任务追踪器 — 追踪当前正在执行的优化操作
const activeTasks = new Map<string, { 
  description: string;
  startedAt: Date;
  targetId?: number;
  accountId?: number;
  module?: string;
}>();

let heartbeatTimer: NodeJS.Timeout | null = null;
let httpServer: unknown = null;

// v491: 部署恢复门控 — 纠错和验证全部完成前，定期优化调度器不应执行
// 确保新版本上线后先完成：扫描优化日志 → 分析合理性 → 纠正错误动作 → 确认Amazon执行
// 然后才允许定期自动优化开始
let _deployRecoveryComplete = false;
let _deployRecoveryCompletedAt: Date | null = null;

/**
 * v491: 检查部署恢复是否已完成
 * 优化调度器在执行前应检查此标志，如果为false则跳过本次执行
 */
export function isDeployRecoveryComplete(): boolean {
  return _deployRecoveryComplete;
}

/**
 * v491: 标记部署恢复已完成，允许定期优化开始
 */
export function markDeployRecoveryComplete(): void {
  _deployRecoveryComplete = true;
  _deployRecoveryCompletedAt = new Date();
  log.info(`[LifecycleManager] v491: 部署恢复已完成，定期优化调度器现在可以开始执行`);
}

/**
 * v491: 获取部署恢复完成时间（供监控使用）
 */
export function getDeployRecoveryCompletedAt(): Date | null {
  return _deployRecoveryCompletedAt;
}

// ==================== 优雅关闭 ====================

/**
 * 注册优雅关闭处理器
 * 应在服务器启动后立即调用
 */
export function registerGracefulShutdown(server: unknown): void {
  httpServer = server;
  
  // 注册信号处理器
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
  
  // 未捕获异常的安全处理
  process.on('uncaughtException', async (error) => {
    log.warn(`[LifecycleManager] 未捕获异常: ${(error as Error).message}`);
    // @ts-expect-error - error stack access
    log.warn(error.stack as unknown);
    await handleShutdown('uncaughtException');
  });
  
  // v359: 添加未处理的Promise拒绝全局捕获，防止进程意外退出
  process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    const errorMessage = reason instanceof Error ? reason.message : String(reason);
    const errorStack = reason instanceof Error ? reason.stack : undefined;
    log.warn(`[LifecycleManager] 未处理的Promise拒绝: ${errorMessage}`);
    if (errorStack) {
      // @ts-expect-error - type assertion
      log.warn(errorStack as unknown);
    }
    // 记录但不关闭进程，避免因单个异步失败导致服务中断
    // 如果是严重的数据库连接错误，触发优雅关闭
    if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('PROTOCOL_CONNECTION_LOST')) {
      log.warn('[LifecycleManager] 检测到严重连接错误，触发优雅关闭');
      handleShutdown('unhandledRejection-critical').catch(() => {});
    }
  });
  
  log.info('[LifecycleManager] v359: 优雅关闭处理器已注册（含 unhandledRejection 全局捕获）');
}

/**
 * 核心关闭流程
 */
async function handleShutdown(signal: string): Promise<void> {
  // 防止重复触发
  if (shutdownState.isShuttingDown) {
    log.debug(`[LifecycleManager] 已在关闭中，忽略重复信号: ${signal}`);
    return;
  }
  
  shutdownState.isShuttingDown = true;
  shutdownState.shutdownStartedAt = new Date();
  shutdownState.shutdownReason = signal;
  
  log.debug(`\n[LifecycleManager] ========================================`);
  log.info(`[LifecycleManager] 收到 ${signal} 信号，开始优雅关闭...`);
  log.debug(`[LifecycleManager] 当前活跃任务: ${activeTasks.size}`);
  log.debug(`[LifecycleManager] ========================================\n`);
  
  const SHUTDOWN_TIMEOUT = 25000; // 25秒超时（EB给30秒，留5秒缓冲）
  
  try {
    // 阶段1: 停止接收新任务（立即执行，<1秒）
    log.debug('[LifecycleManager] 阶段1: 停止接收新任务...');
    await stopNewTaskAcceptance();
    
    // 阶段2: 等待当前任务完成（最多20秒）
    log.info('[LifecycleManager] 阶段2: 等待活跃任务完成...');
    await waitForActiveTasks(20000);
    
    // 阶段3: 持久化系统状态（最多3秒）
    log.info('[LifecycleManager] 阶段3: 持久化系统状态...');
    await persistShutdownState();
    
    // 阶段4: 关闭HTTP服务器（最多2秒）
    log.debug('[LifecycleManager] 阶段4: 关闭HTTP服务器...');
    await closeHttpServer();
    
    log.info(`[LifecycleManager] 优雅关闭完成 (耗时: ${Date.now() - shutdownState.shutdownStartedAt.getTime()}ms)`);
    
  } catch (error: unknown) {
    log.warn(`[LifecycleManager] 关闭过程出错: ${(error as Error).message}`);
  } finally {
    // 确保进程退出
    process.exit(0);
  }
}

/**
 * 阶段1: 停止所有任务源
 */
async function stopNewTaskAcceptance(): Promise<void> {
  try {
    // 停止心跳
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    
    // 停止数据同步调度器
    try {
      stopDataSyncScheduler();
      log.info('[LifecycleManager]   ✓ 数据同步调度器已停止');
    } catch (e: unknown) {
      log.warn(`[LifecycleManager]   ⚠ 停止数据同步调度器失败: ${(e as Error).message}`);
    }
    
    // 停止SQS消费者
    try {
      stopSQSConsumer();
      log.debug('[LifecycleManager]   ✓ SQS消费者已停止');
    } catch (e: unknown) {
      log.warn(`[LifecycleManager]   ⚠ 停止SQS消费者失败: ${(e as Error).message}`);
    }
    
    // 停止报告调度器
    try {
      reportJobScheduler.stop();
      log.debug('[LifecycleManager]   ✓ 报告调度器已停止');
    } catch (e: unknown) {
      log.warn(`[LifecycleManager]   ⚠ 停止报告调度器失败: ${(e as Error).message}`);
    }
    
    // 停止优化调度器
    try {
      stopOptimizationScheduler();
      log.debug('[LifecycleManager]   ✓ 优化调度器已停止');
    } catch (e: unknown) {
      log.warn(`[LifecycleManager]   ⚠ 停止优化调度器失败: ${(e as Error).message}`);
    }
    
    // v417: 停止效果追踪调度器
    try {
      stopEffectTrackingScheduler();
      log.debug('[LifecycleManager]   ✓ 效果追踪调度器已停止');
    } catch (e: unknown) {
      log.warn(`[LifecycleManager]   ⚠ 停止效果追踪调度器失败: ${(e as Error).message}`);
    }
    
  } catch (error: unknown) {
    log.warn(`[LifecycleManager] 停止任务源失败: ${(error as Error).message}`);
  }
}

/**
 * 阶段2: 等待活跃任务完成
 */
async function waitForActiveTasks(maxWaitMs: number): Promise<void> {
  if (activeTasks.size === 0) {
    log.debug('[LifecycleManager]   无活跃任务，直接继续');
    return;
  }
  
  log.info(`[LifecycleManager]   等待 ${activeTasks.size} 个活跃任务完成 (最多 ${maxWaitMs / 1000}秒)...`);
  for (const [taskId, task] of activeTasks) {
    log.debug(`[LifecycleManager]     - ${taskId}: ${task.description} (运行 ${Math.round((Date.now() - task.startedAt.getTime()) / 1000)}秒)`);
  }
  
  const startWait = Date.now();
  const checkInterval = 500; // 每500ms检查一次
  
  while (activeTasks.size > 0 && (Date.now() - startWait) < maxWaitMs) {
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }
  
  if (activeTasks.size > 0) {
    log.warn(`[LifecycleManager]   ⚠ 超时! 仍有 ${activeTasks.size} 个任务未完成，将被中断:`);
    for (const [taskId, task] of activeTasks) {
      log.warn(`[LifecycleManager]     - ${taskId}: ${task.description}`);
    }
  } else {
    log.info(`[LifecycleManager]   ✓ 所有活跃任务已完成 (等待 ${Date.now() - startWait}ms)`);
  }
}

/**
 * 阶段3: 持久化关闭状态到数据库
 */
async function persistShutdownState(): Promise<void> {
  try {
    const database = await getDb();
    if (!database) {
      log.warn('[LifecycleManager]   ⚠ 数据库不可用，跳过状态持久化');
      return;
    }
    
    // 3a: 将 optimization_tasks 中 status='processing' 的任务标记为需要恢复
    try {
      const shutdownNote = ` [v185-shutdown: interrupted by ${shutdownState.shutdownReason}]`;
      const resetResult = await database.execute(sql`
        UPDATE optimization_tasks 
        SET status = 'pending', 
            processing_started_at = NULL,
            error_message = CONCAT(COALESCE(error_message, ''), ${shutdownNote})
        WHERE status = 'processing'
      `);
      // @ts-ignore
      const affectedRows = (resetResult as Record<string, unknown>[])?.[0]?.affectedRows || 0;
      // @ts-ignore
      if (affectedRows > 0) {
        log.debug(`[LifecycleManager]   ✓ 已将 ${affectedRows} 个processing任务重置为pending`);
      } else {
        log.debug('[LifecycleManager]   ✓ 无processing任务需要重置');
      }
    } catch (e: unknown) {
      log.warn(`[LifecycleManager]   ⚠ 重置processing任务失败: ${(e as Error).message}`);
    }
    
    // 3a-2: v409 修复: shutdown时不再无条件杀死running同步任务
    // 原因: 在单实例环境中，shutdown后新实例的startup cleanup (dataSyncScheduler) 会基于updated_at阈值正确清理卡死任务
    // 无条件清理会导致正在正常运行的同步任务被误杀（心跳正常但被标记为failed）
    try {
      const syncResetNote = `v${SYSTEM_VERSION}-shutdown: ${shutdownState.shutdownReason} at ${new Date().toISOString()}`;
      // v409: 只记录日志，不再无条件标记为failed
      // 如果任务真的卡死，dataSyncScheduler的启动清理（30分钟阈值）和定期清理（60分钟阈值）会处理
      const runningJobs = await database.execute(sql`
        // @ts-ignore
        SELECT id, account_id as accountId, current_step FROM data_sync_jobs WHERE status = 'running'
      `);
      // @ts-ignore
      const runningCount = (runningJobs as unknown[])?.[0]?.length || (Array.isArray(runningJobs) ? (runningJobs as unknown[]).filter((r: unknown) => r.id).length : 0);
      if (runningCount > 0) {
        log.info(`[LifecycleManager] v409: shutdown时发现 ${runningCount} 个running同步任务，不再无条件标记为failed，由startup cleanup基于updated_at阈值处理`);
      } else {
        log.debug('[LifecycleManager] v409: shutdown时无running的数据同步任务');
      }
      
      // 同时取消pending状态的同步任务（部署后会重新调度）
      const syncCancelResult = await database.execute(sql`
        UPDATE data_sync_jobs 
        SET status = 'cancelled', 
            completedAt = NOW(),
            // @ts-ignore
            errorMessage = CONCAT(COALESCE(errorMessage, ''), ' [', ${syncResetNote}, ']')
        // @ts-ignore
        WHERE status = 'pending'
      `);
      // @ts-ignore
      const syncCancelled = (syncCancelResult as Record<string, unknown>[])?.[0]?.affectedRows || 0;
      // @ts-ignore
      if (syncCancelled > 0) {
        log.info(`[LifecycleManager]   ✓ 已取消 ${syncCancelled} 个pending的数据同步任务（部署后将重新调度）`);
      }
    } catch (e: unknown) {
      log.warn(`[LifecycleManager]   ⚠ 重置数据同步任务失败: ${(e as Error).message}`);
    }
    
    // 3b: 记录关闭心跳
    try {
      await writeHeartbeat('graceful');
      log.debug('[LifecycleManager]   ✓ 已记录优雅关闭心跳');
    } catch (e: unknown) {
      log.warn(`[LifecycleManager]   ⚠ 记录关闭心跳失败: ${(e as Error).message}`);
    }
    
    // 3c: 记录关闭事件到 optimization_events
    try {
      const interruptedTasks: string[] = [];
      for (const [taskId, task] of activeTasks) {
        interruptedTasks.push(`${taskId}: ${task.description}`);
      }
      
      await database.insert(optimizationEvents).values({
        accountId: 0,
        eventCategory: 'settings_change',
        actionType: 'settings_update',
        actionDetail: JSON.stringify({
          type: 'system_shutdown',
          systemVersion: SYSTEM_VERSION,
          shutdownReason: shutdownState.shutdownReason,
          shutdownType: 'graceful',
          activeTasksAtShutdown: activeTasks.size,
          interruptedTasks,
          shutdownDuration: Date.now() - (shutdownState.shutdownStartedAt?.getTime() || Date.now()),
        }),
        changeReason: `系统优雅关闭 v${SYSTEM_VERSION} (${shutdownState.shutdownReason})`,
        algorithmVersion: `v${SYSTEM_VERSION}`,
        status: 'success',
        apiSyncStatus: 'internal',  // v513: 内部系统事件
      });
      log.debug('[LifecycleManager]   ✓ 已记录关闭事件');
    } catch (e: unknown) {
      log.warn(`[LifecycleManager]   ⚠ 记录关闭事件失败: ${(e as Error).message}`);
    }
    
  } catch (error: unknown) {
    log.warn(`[LifecycleManager] 状态持久化失败: ${(error as Error).message}`);
  }
}

/**
 * 阶段4: 关闭HTTP服务器
 */
async function closeHttpServer(): Promise<void> {
  if (!httpServer) return;
  
  return new Promise<void>((resolve) => {
    // @ts-ignore
    const timeout = setTimeout(() => {
      log.warn('[LifecycleManager]   ⚠ HTTP服务器关闭超时，强制继续');
      resolve();
    }, 2000);
    
    // @ts-ignore
    httpServer.close(() => {
      clearTimeout(timeout);
      log.debug('[LifecycleManager]   ✓ HTTP服务器已关闭');
      resolve();
    });
  });
}

// ==================== 活跃任务追踪 ====================

/**
 * 注册一个活跃任务（在优化操作开始时调用）
 * 返回一个 taskId，用于在任务完成时注销
 */
export function registerActiveTask(description: string, options?: { 
  targetId?: number; 
  accountId?: number; 
  module?: string;
}): string {
  const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  activeTasks.set(taskId, {
    description,
    startedAt: new Date(),
    targetId: options?.targetId,
    accountId: options?.accountId,
    module: options?.module,
  });
  shutdownState.activeTaskCount = activeTasks.size;
  return taskId;
}

/**
 * 注销一个活跃任务（在优化操作完成时调用）
 */
export function unregisterActiveTask(taskId: string): void {
  activeTasks.delete(taskId);
  shutdownState.activeTaskCount = activeTasks.size;
}

/**
 * 检查系统是否正在关闭（优化模块应在每个步骤前检查）
 */
export function isShuttingDown(): boolean {
  return shutdownState.isShuttingDown;
}

/**
 * 获取当前活跃任务数
 */
export function getActiveTaskCount(): number {
  return activeTasks.size;
}

// ==================== 心跳机制 ====================

/**
 * 启动心跳定时器
 * 每60秒写入一次心跳到数据库
 */
export function startHeartbeat(): void {
  // 立即写入一次启动心跳
  writeHeartbeat('running').catch((err: any) => {
    log.warn(`[LifecycleManager] 写入启动心跳失败: ${(err as Error).message}`);
  });
  
  // 每60秒写入一次
  heartbeatTimer = setInterval(async () => {
    try {
      await writeHeartbeat('running');
    } catch (err: unknown) {
      log.warn(`[LifecycleManager] 心跳写入失败: ${(err as Error).message}`);
    }
  }, 60 * 1000);
  
  log.info('[LifecycleManager] v185: 心跳定时器已启动 (间隔: 60秒)');
}

/**
 * 写入心跳到数据库
 */
async function writeHeartbeat(shutdownType: string): Promise<void> {
  const database = await getDb();
  if (!database) return;
  
  // v336: 获取同步健康状态并包含在心跳中
  let syncHealth = { consecutiveFailures: 0, lastSyncTime: null as Date | null, isRunning: false };
  try {
    const { getSyncHealthStatus } = await import('./sync/dataSyncScheduler');
    syncHealth = getSyncHealthStatus();
  } catch (e: any) { log.debug(`[LifecycleManager] 调度器可能未启动: ${(e as Error).message}`); }
  
  // 使用 REPLACE INTO 确保只有一条心跳记录（通过 accountId=0 + type=system_heartbeat 唯一标识）
  await database.execute(sql`
    INSERT INTO optimization_events 
      (account_id, event_category, action_type, action_detail, change_reason, algorithm_version, status, api_sync_status, created_at)
    VALUES 
      (0, 'settings_change', 'settings_update', 
       ${JSON.stringify({
         type: 'system_heartbeat',
         systemVersion: SYSTEM_VERSION,
         shutdownType,
         activeTaskCount: activeTasks.size,
         uptime: process.uptime(),
         syncHealth: {
           consecutiveFailures: syncHealth.consecutiveFailures,
           lastSyncTime: syncHealth.lastSyncTime?.toISOString() || null,
           schedulerRunning: syncHealth.isRunning,
         },
       })},
       'system_heartbeat',
       ${`v${SYSTEM_VERSION}`},
       'success',
       'internal',
       NOW())
    ON DUPLICATE KEY UPDATE
      action_detail = VALUES(action_detail),
      created_at = NOW()
  `);
}

// ==================== 启动诊断与恢复 ====================

/**
 * 运行启动诊断 — 检测上次关闭类型和需要恢复的任务
 */
export async function runStartupDiagnostics(): Promise<StartupDiagnostics> {
  log.info('[LifecycleManager] v185: 运行启动诊断...');
  
  const diagnostics: StartupDiagnostics = {
    lastShutdownType: 'unknown',
    lastHeartbeatAge: -1,
    interruptedTasks: 0,
    pendingTasks: 0,
    versionChanged: false,
    previousVersion: null,
    currentVersion: SYSTEM_VERSION,
  };
  
  try {
    const database = await getDb();
    if (!database) {
      log.warn('[LifecycleManager] 数据库不可用，跳过启动诊断');
      return diagnostics;
    }
    
    // 1. 检查上次关闭事件
    const shutdownEvents = await database
      .select({ actionDetail: optimizationEvents.actionDetail, createdAt: optimizationEvents.createdAt })
      .from(optimizationEvents)
      .where(
        and(
          eq(optimizationEvents.eventCategory, 'settings_change'),
          eq(optimizationEvents.actionType, 'settings_update'),
          sql`JSON_EXTRACT(${optimizationEvents.actionDetail}, '$.type') IN ('system_shutdown', 'system_heartbeat')`
        )
      )
      // @ts-ignore
      .orderBy(desc(optimizationEvents.createdAt))
      .limit(5);
    
    if (shutdownEvents.length > 0) {
      const lastEvent = shutdownEvents[0] as unknown;
      // @ts-ignore
      try {
        // @ts-ignore
        const detail = JSON.parse(lastEvent.actionDetail || '{}');
        if (detail.type === 'system_shutdown' && detail.shutdownType === 'graceful') {
          diagnostics.lastShutdownType = 'graceful';
        } else if (detail.type === 'system_heartbeat') {
          // 如果最后一条记录是心跳而非关闭事件，说明是crash
          // @ts-ignore
          const heartbeatTime = new Date(lastEvent.createdAt || '').getTime();
          const ageSeconds = (Date.now() - heartbeatTime) / 1000;
          diagnostics.lastHeartbeatAge = ageSeconds;
          
          // 如果心跳超过3分钟（正常60秒间隔），说明是非正常关闭
          if (ageSeconds > 180) {
            diagnostics.lastShutdownType = 'crash';
          } else {
            // 可能是正常部署（2-3分钟间隔）
            diagnostics.lastShutdownType = 'unknown';
          }
        }
        diagnostics.previousVersion = detail.systemVersion || null;
      } catch {
        // ignore parse error
      // @ts-ignore
      }
    }
    
    // 2. 检查被中断的任务（status='processing'）
    try {
      const interruptedResult = await database.execute(sql`
        SELECT COUNT(*) as cnt FROM optimization_tasks WHERE status = 'processing'
      `);
      // @ts-ignore
      diagnostics.interruptedTasks = (interruptedResult as Record<string, unknown>[])?.[0]?.[0]?.cnt || 0;
    // @ts-ignore
    } catch {
      // optimization_tasks表可能不存在
    }
    
    // 3. 检查待处理的任务（status='pending'）
    try {
      const pendingResult = await database.execute(sql`
        SELECT COUNT(*) as cnt FROM optimization_tasks WHERE status IN ('pending', 'retry')
      `);
      // @ts-ignore
      diagnostics.pendingTasks = (pendingResult as Record<string, unknown>[])?.[0]?.[0]?.cnt || 0;
    } catch {
      // optimization_tasks表可能不存在
    }
    
    // 4. 版本变化检测
    diagnostics.versionChanged = diagnostics.previousVersion !== null && diagnostics.previousVersion < SYSTEM_VERSION;
    
  } catch (error: unknown) {
    log.warn(`[LifecycleManager] 启动诊断失败: ${(error as Error).message}`);
  }
  
  // 输出诊断结果
  log.info(`[LifecycleManager] 启动诊断结果:`);
  log.debug(`  上次关闭类型: ${diagnostics.lastShutdownType}`);
  log.debug(`  上次心跳距今: ${diagnostics.lastHeartbeatAge >= 0 ? Math.round(diagnostics.lastHeartbeatAge) + '秒' : '无记录'}`);
  log.debug(`  被中断的任务: ${diagnostics.interruptedTasks}`);
  log.info(`  待处理的任务: ${diagnostics.pendingTasks}`);
  log.info(`  版本变化: ${diagnostics.versionChanged ? `v${diagnostics.previousVersion} → v${SYSTEM_VERSION}` : '无'}`);
  
  return diagnostics;
}

/**
 * 恢复被中断的任务
 * 将 status='processing' 的任务重置为 'pending'，让新版本的同步引擎重新处理
 */
export async function recoverInterruptedTasks(): Promise<number> {
  try {
    const database = await getDb();
    if (!database) return 0;
    
    // 将 processing 状态的任务重置为 pending
    // @ts-ignore
    const result = await database.execute(sql`
      UPDATE optimization_tasks 
      SET status = 'pending', 
          processing_started_at = NULL,
          error_message = CONCAT(COALESCE(error_message, ''), ' [v185-recovery: reset after restart]')
      WHERE status = 'processing'
    `);
    
    // @ts-ignore
    const recovered = (result as Record<string, unknown>[])?.[0]?.affectedRows || 0;
    
    // @ts-ignore
    if (recovered > 0) {
      log.debug(`[LifecycleManager] ✓ 已恢复 ${recovered} 个被中断的任务 (processing → pending)`);
      
      // 记录恢复事件
      await database.insert(optimizationEvents).values({
        accountId: 0,
        eventCategory: 'settings_change',
        actionType: 'auto_correction',
        actionDetail: JSON.stringify({
          // @ts-ignore
          type: 'task_recovery',
          systemVersion: SYSTEM_VERSION,
          recoveredTasks: recovered,
          recoveryReason: 'restart_after_deploy',
        }),
        changeReason: `v${SYSTEM_VERSION} 启动恢复: 重置 ${recovered} 个被中断的任务`,
        algorithmVersion: `v${SYSTEM_VERSION}`,
        status: 'success',
        apiSyncStatus: 'internal',  // v513: 内部系统事件
      });
    }
    
    // @ts-ignore
    return recovered;
  } catch (error: unknown) {
    log.warn(`[LifecycleManager] 恢复中断任务失败: ${(error as Error).message}`);
    return 0;
  }
}

/**
 * 触发同步引擎处理恢复的pending任务
 */
export async function flushPendingTasks(): Promise<void> {
  try {
    // @ts-expect-error - type assertion
    const { processSyncQueue } = await import('./sync/optimizationSyncEngine') as unknown;
    if (typeof processSyncQueue === 'function') {
      log.info('[LifecycleManager] 触发同步引擎处理pending任务...');
      const result = await processSyncQueue({});
      log.info(`[LifecycleManager] ✓ 同步引擎处理完成: ${JSON.stringify(result)}`);
    }
  } catch (error: unknown) {
    log.warn(`[LifecycleManager] 触发同步引擎失败: ${(error as Error).message}`);
  }
}

// ==================== 完整启动协调流程 ====================

/**
 * 系统启动协调器 — 在HTTP服务器启动后调用
 * 按正确顺序执行所有启动任务
 */
export async function orchestrateStartup(server: unknown): Promise<void> {
  log.debug(`\n[LifecycleManager] ========================================`);
  log.info(`[LifecycleManager] v${SYSTEM_VERSION}: 系统启动协调开始`);
  log.debug(`[LifecycleManager] ========================================\n`);
  
  // 步骤0: 注册优雅关闭处理器
  registerGracefulShutdown(server);
  
  // 步骤1: 启动心跳
  startHeartbeat();
  
  // 步骤2: 运行启动诊断（立即执行）
  const diagnostics = await runStartupDiagnostics();
  
  // 步骤3: 恢复被中断的任务（立即执行）
  if (diagnostics.interruptedTasks > 0) {
    await recoverInterruptedTasks();
  }
  
  // 步骤3.5: v335 数据同步任务恢复（立即执行）
  // 清理部署前卡死的同步任务，并触发立即同步
  try {
    log.info('[LifecycleManager] v335: 步骤3.5 - 数据同步任务恢复...');
    const database = await getDb();
    if (database) {
      // 3.5a: v409 修复: 只清理updated_at超过5分钟的running任务（而非无条件清理所有）
      // 原因: 心跳每3分钟更新一次updated_at，5分钟无更新说明任务真的卡死了
      // 这避免了服务器重启时误杀刚刚还在正常运行的同步任务
      const staleCleanNote = `v${SYSTEM_VERSION}-startup: cleaned stale running job`;
      const staleThresholdMinutes = 5; // 心跳间隔3分钟，5分钟无更新即判定为卡死
      
      // v411: 任务接管机制 - 先查询即将被清理的任务的断点信息，供调度器启动后从断点恢复
      const interruptedJobsResult = await database.execute(sql`
        SELECT id, accountId, syncType, current_step, current_step_index, total_steps
        FROM data_sync_jobs 
        WHERE status = 'running'
          AND updated_at < DATE_SUB(NOW(), INTERVAL ${sql.raw(String(staleThresholdMinutes))} MINUTE)
      `);
      // Drizzle mysql2返回 [rows, fields]，取第一个元素
      // @ts-ignore
      const interruptedRows = Array.isArray(interruptedJobsResult) ? (interruptedJobsResult as Record<string, unknown>[])[0] : ((interruptedJobsResult as Record<string, unknown>).rows || interruptedJobsResult);
      const interruptedJobs: Array<{id: number, accountId: number, syncType: string, currentStep: string, currentStepIndex: number, totalSteps: number}> = [];
      if (Array.isArray(interruptedRows)) {
        for (const row of interruptedRows) {
          if (row && row.id) {
            interruptedJobs.push({
              id: row.id,
              accountId: row.accountId,
              syncType: row.syncType,
              currentStep: row.current_step,
              currentStepIndex: row.current_step_index || 0,
              totalSteps: row.total_steps || 0,
            // @ts-ignore
            });
          }
        }
      }
      
      // 执行清理
      const staleResult = await database.execute(sql`
        UPDATE data_sync_jobs 
        SET status = 'failed', 
            completedAt = NOW(),
            errorMessage = CONCAT(COALESCE(errorMessage, ''), ' [', ${staleCleanNote}, ']')
        WHERE status = 'running'
          AND updated_at < DATE_SUB(NOW(), INTERVAL ${sql.raw(String(staleThresholdMinutes))} MINUTE)
      `);
      // @ts-ignore
      const staleCleaned = (staleResult as Record<string, unknown>[])?.[0]?.affectedRows || 0;
      
      // v411: 将断点信息存入全局变量，供调度器启动后读取
      if (interruptedJobs.length > 0) {
        (global as Record<string, unknown>).__interrupted_sync_jobs = interruptedJobs;
        log.info(`[LifecycleManager] v411:   ℹ 记录了 ${interruptedJobs.length} 个中断任务的断点信息: ${interruptedJobs.map(j => `Job${j.id}(账户${j.accountId},步骤${j.currentStepIndex}/${j.totalSteps})`).join(', ')}`);
      }
      
      // 同时检查是否有还在正常运行的任务（心跳正常）
      const activeJobs = await database.execute(sql`
        SELECT id, current_step, updated_at FROM data_sync_jobs 
        WHERE status = 'running'
          AND updated_at >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(staleThresholdMinutes))} MINUTE)
      `);
      // @ts-ignore
      const activeCount = (activeJobs as unknown[])?.[0]?.length || (Array.isArray(activeJobs) ? (activeJobs as unknown[]).filter((r: unknown) => r.id).length : 0);
      
      // @ts-ignore
      if (staleCleaned > 0) {
        // @ts-ignore
        log.info(`[LifecycleManager] v411:   ✓ 清理了 ${staleCleaned} 个卡死的数据同步任务（updated_at超过${staleThresholdMinutes}分钟未更新）`);
      // @ts-ignore
      }
      if (activeCount > 0) {
        log.info(`[LifecycleManager] v411:   ℹ 发现 ${activeCount} 个心跳正常的running任务，保留不清理`);
      // @ts-ignore
      }
      
      // 3.5b: 检查最后成功同步时间，如果超过2小时未同步则记录告警
      const lastSyncResult = await database.execute(sql`
        SELECT accountId as account_id, MAX(completedAt) as last_sync 
        FROM data_sync_jobs 
        WHERE status = 'completed' 
        GROUP BY accountId
      `);
      // @ts-ignore
      const lastSyncs = (lastSyncResult as Record<string, unknown>[])?.[0] || [];
      // @ts-ignore
      const now = Date.now();
      const staleAccounts: number[] = [];
      // @ts-ignore
      for (const row of (lastSyncs as unknown[])) {
        // @ts-ignore
        if (row.last_sync) {
          // @ts-ignore
          const lastSyncTime = new Date(row.last_sync).getTime();
          const hoursSinceSync = (now - lastSyncTime) / (1000 * 60 * 60);
          if (hoursSinceSync > 2) {
            // @ts-ignore
            staleAccounts.push(row.account_id);
            // @ts-ignore
            log.warn(`[LifecycleManager] v335:   ⚠ 账户 ${row.account_id} 已 ${hoursSinceSync.toFixed(1)} 小时未成功同步`);
          }
        }
      }
      
      if (staleAccounts.length > 0) {
        log.info(`[LifecycleManager] v335:   ℹ ${staleAccounts.length} 个账户同步滞后，将在数据同步调度器启动后立即触发同步`);
      }
      
      // 3.5c: 记录同步恢复事件
      // @ts-ignore
      if (staleCleaned > 0 || staleAccounts.length > 0) {
        const detail = JSON.stringify({
          type: 'data_sync_recovery',
          systemVersion: SYSTEM_VERSION,
          staleJobsCleaned: staleCleaned,
          staleAccounts: staleAccounts,
          staleAccountCount: staleAccounts.length,
        });
        await database.execute(sql`
          // @ts-ignore
          INSERT INTO optimization_events (account_id, event_category, action_type, action_detail, change_reason, algorithm_version, status, api_sync_status) 
          // @ts-ignore
          VALUES (0, 'settings_change', 'auto_correction', ${detail}, ${`v${SYSTEM_VERSION} 启动恢复: 清理${staleCleaned}个卡死同步任务, ${staleAccounts.length}个账户同步滞后`}, ${`v${SYSTEM_VERSION}`}, 'success', 'internal')
        // @ts-ignore
        `);
      // @ts-ignore
      }
      
      // v405: 3.5d - 部署后触发轻量级同步（high层级），避免与用户手动同步冲突
      // v336原始设计: full层级同步，但这会导致CPU飙升触发Auto Scaling频繁伸缩
      // v405改进: 使用high层级（仅同步campaigns和当日绩效），full/nightly由定时器调度
      log.info(`[LifecycleManager] v405: 步骤3.5d - 部署后轻量级数据同步(high层级)...`);
      setTimeout(async () => {
        try {
          const { syncAllAccounts } = await import('./sync/unifiedSyncEngine');
          const syncResult: unknown = await syncAllAccounts('high');
          // @ts-ignore
          log.info(`[LifecycleManager] v405: 部署后轻量级同步完成 - 成功: ${syncResult.successfulAccounts}/${syncResult.totalAccounts}, 失败: ${syncResult.failedAccounts}, 耗时: ${syncResult.durationMs}ms`);
          
          // v491: 同步完成后不再立即触发优化
          // 原因: 必须等待纠错流程完成后才能开始新的优化
          // 优化将在步骤4的纠错→验证→重优化流程中统一触发
          log.info(`[LifecycleManager] v491: 同步完成，但优化将在纠错流程完成后统一触发（不再立即触发）`);
          
          // 记录部署后同步完成事件
          const syncDetail = JSON.stringify({
            type: 'deploy_recovery_sync_complete',
            systemVersion: SYSTEM_VERSION,
            // @ts-ignore
            totalAccounts: syncResult.totalAccounts,
            // @ts-ignore
            successfulAccounts: syncResult.successfulAccounts,
            // @ts-ignore
            failedAccounts: syncResult.failedAccounts,
            // @ts-ignore
            durationMs: syncResult.durationMs,
          });
          await database.execute(sql`
            INSERT INTO optimization_events (account_id, event_category, action_type, action_detail, change_reason, algorithm_version, status, api_sync_status) 
            // @ts-ignore
            VALUES (0, 'settings_change', 'auto_correction', ${syncDetail}, ${`v${SYSTEM_VERSION} 部署后完整同步完成: ${(syncResult as any).successfulAccounts}/${(syncResult as any).totalAccounts}成功`}, ${`v${SYSTEM_VERSION}`}, 'success', 'internal')
          `);
        } catch (syncErr: unknown) {
          log.warn(`[LifecycleManager] v405: 部署后轻量级同步失败: ${(syncErr as Error).message}`);
        }
      }, 15 * 1000); // 延迟15秒，给系统时间完成初始化
    }
  } catch (syncRecoveryErr: unknown) {
    log.warn(`[LifecycleManager] v335: 数据同步恢复失败（不影响系统启动）: ${(syncRecoveryErr as Error).message}`);
  }
  
  // 步骤4: 延迟30秒后执行纠错和重优化
  // （给系统时间完成初始化、建立数据库连接池等）
  setTimeout(async () => {
    try {
      // 步骤4a: 处理恢复的pending任务
      if (diagnostics.pendingTasks > 0 || diagnostics.interruptedTasks > 0) {
        log.info(`[LifecycleManager] 处理 ${diagnostics.pendingTasks + diagnostics.interruptedTasks} 个待处理/恢复的任务...`);
        await flushPendingTasks();
      }
      
      // v491: 重构启动协调顺序 — 纠错优先，确认执行后才重优化
      // 正确顺序: 纠错扫描 → 指令重评估 → 等待Amazon确认 → 二次验证 → 重优化 → 冷启动 → 标记完成
      // 理由: 新版本上线后必须先纠正旧版本的错误优化动作，确认Amazon正确执行后，才能开始新的优化
      
      // 步骤4b: 运行API执行级纠错（第一优先级）
      let corrResult: Record<string, unknown> = { totalIssuesFound: 0, totalCorrected: 0, totalFailed: 0 };
      try {
        log.info('[LifecycleManager] v491: 步骤4b - 运行API执行级纠错（扫描所有优化日志，检测并修复错误优化动作）...');
        const { runAutoCorrection } = await import('./optimization/optimizationAutoCorrector');
        // @ts-ignore
        corrResult = await runAutoCorrection();
        log.info(`[LifecycleManager] v491: ✓ 纠错完成: 发现${corrResult.totalIssuesFound}个问题, 纠正${corrResult.totalCorrected}个`);
      } catch (corrErr: unknown) {
        log.warn(`[LifecycleManager] v491: 纠错扫描失败（已隔离，继续执行指令重评估）: ${(corrErr as Error).message}`);
      }
      
      // 步骤4c: 部署后指令重评估与自动纠错（独立错误隔离）
      try {
        log.info('[LifecycleManager] v491: 步骤4c - 运行部署后指令重评估与自动纠错...');
        const { runFullRevalidation } = await import('./postDeployCommandRevalidator');
        const revalResult = await runFullRevalidation();
        log.info(`[LifecycleManager] v491: ✓ 指令重评估完成: ${revalResult.targetsProcessed}个目标, pending=${revalResult.totalPendingRevalidated}(取消${revalResult.totalPendingCancelled},重触发${revalResult.totalPendingRetriggered}), 历史纠正=${revalResult.totalCorrectionsGenerated}`);
      } catch (revalErr: unknown) {
        log.warn(`[LifecycleManager] v491: 指令重评估失败（已隔离，继续执行验证）: ${(revalErr as Error).message}`);
      }
      
      // 步骤4d: 等待60秒让Amazon处理纠错指令，然后进行二次验证
      if (Number(corrResult.totalCorrected) > 0) {
        try {
          log.info(`[LifecycleManager] v491: 步骤4d - 等待60秒让Amazon处理${corrResult.totalCorrected}个纠错指令...`);
          await new Promise(resolve => setTimeout(resolve, 60 * 1000));
          
          const { runAutoCorrection: runVerify } = await import('./optimization/optimizationAutoCorrector');
          const verifyResult = await runVerify();
          const newIssues = verifyResult.totalIssuesFound;
          const newCorrected = verifyResult.totalCorrected;
          
          if (newIssues === 0) {
            log.info(`[LifecycleManager] v491: ✓ 二次验证通过 — 所有纠错指令已被Amazon成功执行`);
          } else {
            log.warn(`[LifecycleManager] v491: ⚠ 二次验证发现${newIssues}个残余不一致, 已自动纠正${newCorrected}个`);
          // @ts-ignore
          }
          
          // 记录验证结果
          try {
            const database = await getDb();
            if (database) {
              const detail = JSON.stringify({
                type: 'post_deploy_correction_verification', systemVersion: SYSTEM_VERSION,
                correctionResult: { issuesFound: corrResult.totalIssuesFound, corrected: corrResult.totalCorrected },
                verificationResult: { issuesFound: newIssues, corrected: newCorrected, passed: newIssues === 0 },
              });
              const reason = `v${SYSTEM_VERSION} 纠错后二次验证: ${newIssues === 0 ? '通过' : `发现${newIssues}个残余不一致`}`;
              const algVer = `v${SYSTEM_VERSION}`;
              const status = newIssues === 0 ? 'success' : 'pending';
              await database.execute(sql`INSERT INTO optimization_events (account_id, event_category, action_type, action_detail, change_reason, algorithm_version, status, api_sync_status) VALUES (0, 'settings_change', 'auto_correction', ${detail}, ${reason}, ${algVer}, ${status}, 'internal')`);
            }
          } catch (logErr: unknown) {
            log.warn(`[LifecycleManager] v491: 记录验证结果失败（不影响系统运行）: ${(logErr as Error).message}`);
          }
        } catch (verifyErr: unknown) {
          log.warn(`[LifecycleManager] v491: 二次验证失败（不影响系统运行）: ${(verifyErr as Error).message}`);
        }
      } else {
        log.info('[LifecycleManager] v491: 无纠错操作，跳过二次验证');
      }
      
      // 步骤4e: 纠错完成，现在可以安全地运行部署后重优化（独立错误隔离）
      let deployResult: Record<string, unknown> = { triggered: false, reason: 'not_executed', targetsProcessed: 0, targetsSucceeded: 0, targetsFailed: 0, totalOptimizationActions: 0 };
      try {
        log.info('[LifecycleManager] v491: 步骤4e - 纠错已完成，现在运行部署后重优化（新算法）...');
        const { runPostDeployOptimization } = await import('./postDeployOptimizer');
        // @ts-ignore
        deployResult = await runPostDeployOptimization();
        if (deployResult.triggered) {
          log.info(`[LifecycleManager] v491: ✓ 部署后重优化完成: ${deployResult.targetsProcessed}个目标, ${deployResult.targetsSucceeded}个成功, ${deployResult.totalOptimizationActions}个优化动作`);
        } else {
          log.debug(`[LifecycleManager] v491: ✓ ${deployResult.reason}`);
        }
      } catch (deployErr: unknown) {
        log.warn(`[LifecycleManager] v491: 部署后重优化失败（已隔离，不影响系统运行）: ${(deployErr as Error).message}`);
      }
      
      // 步骤4f: 版本升级场景的智能冷启动
      try {
        log.info('[LifecycleManager] v491: 步骤4f - 检测是否需要执行智能冷启动...');
        const { triggerColdStartForAllAccounts } = await import('./optimization/coldStartService');
        const coldStartResult = await triggerColdStartForAllAccounts('version_upgrade', {
          skipSync: false,
          historicalDays: 90,
          recentDays: 14,
        });
        if (coldStartResult.triggered > 0) {
          log.info(`[LifecycleManager] v491: 智能冷启动已触发 ${coldStartResult.triggered}/${coldStartResult.total} 个账户`);
        } else {
          log.info(`[LifecycleManager] v491: 无需冷启动（所有账户已在当前版本执行过）`);
        }
      } catch (coldStartErr: unknown) {
        log.warn(`[LifecycleManager] v491: 智能冷启动失败（已隔离，不影响系统运行）: ${(coldStartErr as Error).message}`);
      }
      
      // 步骤4g: 如果是crash恢复，记录恢复完成事件
      if (diagnostics.lastShutdownType === 'crash') {
        try {
          const database = await getDb();
          if (database) {
            const detail = JSON.stringify({
              type: 'crash_recovery_complete', systemVersion: SYSTEM_VERSION, diagnostics,
              correctionResult: { issuesFound: corrResult.totalIssuesFound, corrected: corrResult.totalCorrected },
              deployResult: { triggered: deployResult.triggered, targetsProcessed: deployResult.targetsProcessed, targetsSucceeded: deployResult.targetsSucceeded },
            });
            const reason = `v${SYSTEM_VERSION} crash恢复完成`;
            const algVer = `v${SYSTEM_VERSION}`;
            await database.execute(sql`INSERT INTO optimization_events (account_id, event_category, action_type, action_detail, change_reason, algorithm_version, status, api_sync_status) VALUES (0, 'settings_change', 'auto_correction', ${detail}, ${reason}, ${algVer}, 'success', 'internal')`);
          }
        } catch (crashLogErr: unknown) {
          log.warn(`[LifecycleManager] v491: 记录crash恢复事件失败（不影响系统运行）: ${(crashLogErr as Error).message}`);
        }
      }
      
      // 步骤4h: v491 标记部署恢复完成 — 允许定期优化调度器开始执行
      markDeployRecoveryComplete();
      log.info(`[LifecycleManager] v491: ✅ 部署恢复全部完成（纠错=${corrResult.totalCorrected}, 重优化=${deployResult.totalOptimizationActions}），定期优化现在可以开始`);
      
      // 步骤4i: 运行系统监控检查
      try {
        log.info('[LifecycleManager] 运行系统监控检查...');
        const { runMonitoringCheck, formatMonitoringReport } = await import('./optimization/optimizationMonitoringService');
        const database = await getDb();
        if (database) {
          const teams = await database.selectDistinct({ teamId: optimizationEvents.userId }).from(optimizationEvents).limit(10);
          for (const team of teams) {
            if (team.teamId) {
              const report = await runMonitoringCheck(team.teamId);
              log.info(`[MonitoringService] 团队${team.teamId}: 健康评分${report.healthScore}/100 (${report.status}), ${report.alerts.length}个告警`);
            }
          }
        }
      } catch (monErr: unknown) {
        log.warn(`[LifecycleManager] 监控检查失败（不影响系统运行）: ${(monErr as Error).message}`);
      }

      log.debug(`\n[LifecycleManager] ========================================`);
      log.info(`[LifecycleManager] v${SYSTEM_VERSION}: 启动协调完成，系统进入正常运行`);
      log.debug(`[LifecycleManager] ========================================\n`);
      
    } catch (err: unknown) {
      log.warn(`[LifecycleManager] 启动协调任务失败: ${(err as Error).message}`);
      // @ts-expect-error - error stack access
      log.warn((err as Error).stack);
    }
  }, 30 * 1000);
  
  log.info(`[LifecycleManager] 启动协调: 初始化完成，纠错和重优化将在30秒后执行`);
}

// ==================== 导出工具函数 ====================

/**
 * 获取系统版本信息（供API查询）
 */
export function getSystemInfo(): {
  version: number;
  isShuttingDown: boolean;
  activeTasks: number;
  uptime: number;
} {
  return {
    version: SYSTEM_VERSION,
    isShuttingDown: shutdownState.isShuttingDown,
    activeTasks: activeTasks.size,
    uptime: process.uptime(),
  };
}
