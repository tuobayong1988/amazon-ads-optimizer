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
import { stopDataSyncScheduler, stopOptimizationScheduler } from './dataSyncScheduler';
import { stopSQSConsumer } from './sqsConsumerService';
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
let httpServer: any = null;

// ==================== 优雅关闭 ====================

/**
 * 注册优雅关闭处理器
 * 应在服务器启动后立即调用
 */
export function registerGracefulShutdown(server: any): void {
  httpServer = server;
  
  // 注册信号处理器
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
  
  // 未捕获异常的安全处理
  process.on('uncaughtException', async (error) => {
    log.error(`[LifecycleManager] 未捕获异常: ${error.message}`);
    log.error(error.stack as any);
    await handleShutdown('uncaughtException');
  });
  
  log.info('[LifecycleManager] v185: 优雅关闭处理器已注册');
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
    
  } catch (error: any) {
    log.error(`[LifecycleManager] 关闭过程出错: ${error.message}`);
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
    } catch (e: any) {
      log.warn(`[LifecycleManager]   ⚠ 停止数据同步调度器失败: ${e.message}`);
    }
    
    // 停止SQS消费者
    try {
      stopSQSConsumer();
      log.debug('[LifecycleManager]   ✓ SQS消费者已停止');
    } catch (e: any) {
      log.warn(`[LifecycleManager]   ⚠ 停止SQS消费者失败: ${e.message}`);
    }
    
    // 停止报告调度器
    try {
      reportJobScheduler.stop();
      log.debug('[LifecycleManager]   ✓ 报告调度器已停止');
    } catch (e: any) {
      log.warn(`[LifecycleManager]   ⚠ 停止报告调度器失败: ${e.message}`);
    }
    
    // 停止优化调度器
    try {
      stopOptimizationScheduler();
      log.debug('[LifecycleManager]   ✓ 优化调度器已停止');
    } catch (e: any) {
      log.warn(`[LifecycleManager]   ⚠ 停止优化调度器失败: ${e.message}`);
    }
    
  } catch (error: any) {
    log.error(`[LifecycleManager] 停止任务源失败: ${error.message}`);
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
      const affectedRows = (resetResult as any)?.[0]?.affectedRows || 0;
      if (affectedRows > 0) {
        log.debug(`[LifecycleManager]   ✓ 已将 ${affectedRows} 个processing任务重置为pending`);
      } else {
        log.debug('[LifecycleManager]   ✓ 无processing任务需要重置');
      }
    } catch (e: any) {
      log.warn(`[LifecycleManager]   ⚠ 重置processing任务失败: ${e.message}`);
    }
    
    // 3b: 记录关闭心跳
    try {
      await writeHeartbeat('graceful');
      log.debug('[LifecycleManager]   ✓ 已记录优雅关闭心跳');
    } catch (e: any) {
      log.warn(`[LifecycleManager]   ⚠ 记录关闭心跳失败: ${e.message}`);
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
        apiSyncStatus: 'not_applicable',
      });
      log.debug('[LifecycleManager]   ✓ 已记录关闭事件');
    } catch (e: any) {
      log.warn(`[LifecycleManager]   ⚠ 记录关闭事件失败: ${e.message}`);
    }
    
  } catch (error: any) {
    log.error(`[LifecycleManager] 状态持久化失败: ${error.message}`);
  }
}

/**
 * 阶段4: 关闭HTTP服务器
 */
async function closeHttpServer(): Promise<void> {
  if (!httpServer) return;
  
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      log.warn('[LifecycleManager]   ⚠ HTTP服务器关闭超时，强制继续');
      resolve();
    }, 2000);
    
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
  writeHeartbeat('running').catch(err => {
    log.warn(`[LifecycleManager] 写入启动心跳失败: ${err.message}`);
  });
  
  // 每60秒写入一次
  heartbeatTimer = setInterval(async () => {
    try {
      await writeHeartbeat('running');
    } catch (err: any) {
      log.warn(`[LifecycleManager] 心跳写入失败: ${err.message}`);
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
       })},
       'system_heartbeat',
       ${`v${SYSTEM_VERSION}`},
       'success',
       'not_applicable',
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
      .orderBy(desc(optimizationEvents.createdAt))
      .limit(5);
    
    if (shutdownEvents.length > 0) {
      const lastEvent = shutdownEvents[0];
      try {
        const detail = JSON.parse(lastEvent.actionDetail || '{}');
        if (detail.type === 'system_shutdown' && detail.shutdownType === 'graceful') {
          diagnostics.lastShutdownType = 'graceful';
        } else if (detail.type === 'system_heartbeat') {
          // 如果最后一条记录是心跳而非关闭事件，说明是crash
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
      }
    }
    
    // 2. 检查被中断的任务（status='processing'）
    try {
      const interruptedResult = await database.execute(sql`
        SELECT COUNT(*) as cnt FROM optimization_tasks WHERE status = 'processing'
      `);
      diagnostics.interruptedTasks = (interruptedResult as any)?.[0]?.[0]?.cnt || 0;
    } catch {
      // optimization_tasks表可能不存在
    }
    
    // 3. 检查待处理的任务（status='pending'）
    try {
      const pendingResult = await database.execute(sql`
        SELECT COUNT(*) as cnt FROM optimization_tasks WHERE status IN ('pending', 'retry')
      `);
      diagnostics.pendingTasks = (pendingResult as any)?.[0]?.[0]?.cnt || 0;
    } catch {
      // optimization_tasks表可能不存在
    }
    
    // 4. 版本变化检测
    diagnostics.versionChanged = diagnostics.previousVersion !== null && diagnostics.previousVersion < SYSTEM_VERSION;
    
  } catch (error: any) {
    log.error(`[LifecycleManager] 启动诊断失败: ${error.message}`);
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
    const result = await database.execute(sql`
      UPDATE optimization_tasks 
      SET status = 'pending', 
          processing_started_at = NULL,
          error_message = CONCAT(COALESCE(error_message, ''), ' [v185-recovery: reset after restart]')
      WHERE status = 'processing'
    `);
    
    const recovered = (result as any)?.[0]?.affectedRows || 0;
    
    if (recovered > 0) {
      log.debug(`[LifecycleManager] ✓ 已恢复 ${recovered} 个被中断的任务 (processing → pending)`);
      
      // 记录恢复事件
      await database.insert(optimizationEvents).values({
        accountId: 0,
        eventCategory: 'settings_change',
        actionType: 'auto_correction',
        actionDetail: JSON.stringify({
          type: 'task_recovery',
          systemVersion: SYSTEM_VERSION,
          recoveredTasks: recovered,
          recoveryReason: 'restart_after_deploy',
        }),
        changeReason: `v${SYSTEM_VERSION} 启动恢复: 重置 ${recovered} 个被中断的任务`,
        algorithmVersion: `v${SYSTEM_VERSION}`,
        status: 'success',
        apiSyncStatus: 'not_applicable',
      });
    }
    
    return recovered;
  } catch (error: any) {
    log.error(`[LifecycleManager] 恢复中断任务失败: ${error.message}`);
    return 0;
  }
}

/**
 * 触发同步引擎处理恢复的pending任务
 */
export async function flushPendingTasks(): Promise<void> {
  try {
    const { processSyncQueue } = await import('./optimizationSyncEngine') as any;
    if (typeof processSyncQueue === 'function') {
      log.info('[LifecycleManager] 触发同步引擎处理pending任务...');
      const result = await processSyncQueue({});
      log.info(`[LifecycleManager] ✓ 同步引擎处理完成: ${JSON.stringify(result)}`);
    }
  } catch (error: any) {
    log.warn(`[LifecycleManager] 触发同步引擎失败: ${error.message}`);
  }
}

// ==================== 完整启动协调流程 ====================

/**
 * 系统启动协调器 — 在HTTP服务器启动后调用
 * 按正确顺序执行所有启动任务
 */
export async function orchestrateStartup(server: any): Promise<void> {
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
  
  // 步骤4: 延迟30秒后执行纠错和重优化
  // （给系统时间完成初始化、建立数据库连接池等）
  setTimeout(async () => {
    try {
      // 步骤4a: 处理恢复的pending任务
      if (diagnostics.pendingTasks > 0 || diagnostics.interruptedTasks > 0) {
        log.info(`[LifecycleManager] 处理 ${diagnostics.pendingTasks + diagnostics.interruptedTasks} 个待处理/恢复的任务...`);
        await flushPendingTasks();
      }
      
      // 步骤4b: 运行API执行级纠错
      log.info('[LifecycleManager] 运行API执行级纠错...');
      const { runAutoCorrection } = await import('./optimizationAutoCorrector');
      const corrResult = await runAutoCorrection();
      log.info(`[LifecycleManager] ✓ 纠错完成: 发现${corrResult.totalIssuesFound}个问题, 纠正${corrResult.totalCorrected}个`);
      
      // 步骤4c: 运行部署后重优化
      log.debug('[LifecycleManager] 运行部署后重优化...');
      const { runPostDeployOptimization } = await import('./postDeployOptimizer');
      const deployResult = await runPostDeployOptimization();
      if (deployResult.triggered) {
        log.info(`[LifecycleManager] ✓ 部署后重优化完成: ${deployResult.targetsProcessed}个目标, ${deployResult.targetsSucceeded}个成功`);
      } else {
        log.debug(`[LifecycleManager] ✓ ${deployResult.reason}`);
      }
      
      // 步骤4d: 如果是crash恢复，记录恢复完成事件
      if (diagnostics.lastShutdownType === 'crash') {
        const database = await getDb();
        if (database) {
          await database.insert(optimizationEvents).values({
            accountId: 0,
            eventCategory: 'settings_change',
            actionType: 'auto_correction',
            actionDetail: JSON.stringify({
              type: 'crash_recovery_complete',
              systemVersion: SYSTEM_VERSION,
              diagnostics,
              correctionResult: {
                issuesFound: corrResult.totalIssuesFound,
                corrected: corrResult.totalCorrected,
              },
              deployResult: {
                triggered: deployResult.triggered,
                targetsProcessed: deployResult.targetsProcessed,
                targetsSucceeded: deployResult.targetsSucceeded,
              },
            }),
            changeReason: `v${SYSTEM_VERSION} crash恢复完成`,
            algorithmVersion: `v${SYSTEM_VERSION}`,
            status: 'success',
            apiSyncStatus: 'not_applicable',
          });
        }
      }
      
      // 步骤4e: v239 运行系统监控检查
      try {
        log.info('[LifecycleManager] 运行系统监控检查...');
        const { runMonitoringCheck, formatMonitoringReport } = await import('./optimizationMonitoringService');
        const database = await getDb();
        if (database) {
          // 获取所有团队ID进行监控
          const teams = await database.selectDistinct({ teamId: optimizationEvents.teamId }).from(optimizationEvents).limit(10);
          for (const team of teams) {
            if (team.teamId) {
              const report = await runMonitoringCheck(team.teamId);
              log.info(`[MonitoringService] 团队${team.teamId}: 健康评分${report.healthScore}/100 (${report.status}), ${report.alerts.length}个告警`);
            }
          }
        }
      } catch (monErr: any) {
        log.warn(`[LifecycleManager] 监控检查失败（不影响系统运行）: ${monErr.message}`);
      }

      log.debug(`\n[LifecycleManager] ========================================`);
      log.info(`[LifecycleManager] v${SYSTEM_VERSION}: 启动协调完成，系统进入正常运行`);
      log.debug(`[LifecycleManager] ========================================\n`);
      
    } catch (err: any) {
      log.error(`[LifecycleManager] 启动协调任务失败: ${err.message}`);
      log.error(err.stack);
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
