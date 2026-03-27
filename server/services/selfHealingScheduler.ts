/**
 * v359: 独立自愈任务调度器
 * 
 * 解决评估报告中指出的问题:
 * 1. 自愈任务强依赖主同步流程（dataSyncScheduler的setInterval）
 *    → 主同步崩溃时自愈也停止（"免疫抑制"风险）
 * 2. 自愈任务没有独立的生命周期管理
 *    → 无法单独启停、监控和调试
 * 3. 自愈任务间缺少协调机制
 *    → 可能同时触发多个修复导致资源争抢
 * 
 * 设计原则:
 * - 完全独立于主同步流程，有自己的事件循环
 * - 自带看门狗（watchdog），确保调度器自身不会静默死亡
 * - 任务间互斥，避免资源争抢
 * - 分级自愈：轻量检查(高频) → 深度检查(低频) → 全量修复(按需)
 * - 完整的执行日志和指标收集
 */

import { createModuleLogger } from '../utils/logger';
import { AsyncMutex } from '../utils/asyncMutex';

const log = createModuleLogger('SelfHealingScheduler');

// ==================== 类型定义 ====================

/** 自愈任务定义 */
interface HealingTask {
  id: string;
  name: string;
  /** 任务级别: probe(探针) < check(检查) < repair(修复) < emergency(紧急) */
  level: 'probe' | 'check' | 'repair' | 'emergency';
  /** 执行间隔（毫秒） */
  intervalMs: number;
  /** 任务执行函数 */
  execute: () => Promise<HealingTaskResult>;
  /** 是否启用 */
  enabled: boolean;
  /** 最大执行时间（毫秒），超时自动终止 */
  timeoutMs: number;
  /** 连续失败后是否自动禁用 */
  disableOnConsecutiveFailures?: number;
}

/** 自愈任务执行结果 */
interface HealingTaskResult {
  success: boolean;
  /** 发现的问题数 */
  issuesFound: number;
  /** 修复的问题数 */
  issuesFixed: number;
  /** 详细信息 */
  details: string;
  /** 是否需要升级到更高级别的修复 */
  escalate?: boolean;
  /** 升级原因 */
  escalateReason?: string;
}

/** 任务执行记录 */
interface TaskExecutionRecord {
  taskId: string;
  startTime: Date;
  endTime: Date;
  durationMs: number;
  result: HealingTaskResult;
  error?: string;
}

/** 调度器状态 */
export interface SelfHealingStatus {
  running: boolean;
  startedAt: Date | null;
  totalExecutions: number;
  totalIssuesFound: number;
  totalIssuesFixed: number;
  taskStatuses: Record<string, {
    lastRun: Date | null;
    lastResult: HealingTaskResult | null;
    consecutiveFailures: number;
    totalRuns: number;
    enabled: boolean;
  }>;
  watchdogAlive: boolean;
  lastWatchdogCheck: Date | null;
}

// ==================== 自愈调度器 ====================

export class SelfHealingScheduler {
  private tasks: Map<string, HealingTask> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private executionHistory: TaskExecutionRecord[] = [];
  private taskStatuses: Map<string, {
    lastRun: Date | null;
    lastResult: HealingTaskResult | null;
    consecutiveFailures: number;
    totalRuns: number;
    enabled: boolean;
  }> = new Map();
  
  private running = false;
  private startedAt: Date | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private lastWatchdogCheck: Date | null = null;
  
  private totalExecutions = 0;
  private totalIssuesFound = 0;
  private totalIssuesFixed = 0;
  
  /** 全局互斥锁，防止多个修复任务同时执行 */
  private repairMutex = new AsyncMutex('self-healing-repair');
  
  constructor() {
    log.info('[SelfHealingScheduler] v359: 初始化独立自愈调度器');
  }
  
  /**
   * 注册自愈任务
   */
  registerTask(task: HealingTask): void {
    this.tasks.set(task.id, task);
    this.taskStatuses.set(task.id, {
      lastRun: null,
      lastResult: null,
      consecutiveFailures: 0,
      totalRuns: 0,
      enabled: task.enabled,
    });
    log.info(`[SelfHealingScheduler] 注册任务: ${task.id} (${task.name}), 级别=${task.level}, 间隔=${task.intervalMs}ms`);
  }
  
  /**
   * 启动调度器
   */
  start(): void {
    if (this.running) {
      log.warn('[SelfHealingScheduler] 调度器已在运行中');
      return;
    }
    
    this.running = true;
    this.startedAt = new Date();
    
    // 启动所有已注册的任务
    for (const [taskId, task] of this.tasks.entries()) {
      if (task.enabled) {
        this.scheduleTask(taskId);
      }
    }
    
    // 启动看门狗
    this.startWatchdog();
    
    log.info(`[SelfHealingScheduler] v359: 调度器已启动, ${this.tasks.size}个任务已注册`);
  }
  
  /**
   * 停止调度器
   */
  stop(): void {
    this.running = false;
    
    // 清除所有定时器
    for (const [taskId, timer] of this.timers.entries()) {
      clearTimeout(timer);
      log.info(`[SelfHealingScheduler] 停止任务: ${taskId}`);
    }
    this.timers.clear();
    
    // 停止看门狗
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    
    log.info('[SelfHealingScheduler] v359: 调度器已停止');
  }
  
  /**
   * 手动触发指定任务
   */
  async triggerTask(taskId: string): Promise<HealingTaskResult | null> {
    const task = this.tasks.get(taskId);
    if (!task) {
      log.warn(`[SelfHealingScheduler] 未找到任务: ${taskId}`);
      return null;
    }
    
    return this.executeTask(task);
  }
  
  /**
   * 启用/禁用任务
   */
  setTaskEnabled(taskId: string, enabled: boolean): void {
    const task = this.tasks.get(taskId);
    const status = this.taskStatuses.get(taskId);
    if (task && status) {
      task.enabled = enabled;
      status.enabled = enabled;
      
      if (enabled && this.running) {
        this.scheduleTask(taskId);
      } else if (!enabled) {
        const timer = this.timers.get(taskId);
        if (timer) {
          clearTimeout(timer);
          this.timers.delete(taskId);
        }
      }
      
      log.info(`[SelfHealingScheduler] 任务${taskId} ${enabled ? '已启用' : '已禁用'}`);
    }
  }
  
  /**
   * 获取调度器状态
   */
  getStatus(): SelfHealingStatus {
    const taskStatuses: SelfHealingStatus['taskStatuses'] = {};
    for (const [taskId, status] of this.taskStatuses.entries()) {
      taskStatuses[taskId] = { ...status };
    }
    
    return {
      running: this.running,
      startedAt: this.startedAt,
      totalExecutions: this.totalExecutions,
      totalIssuesFound: this.totalIssuesFound,
      totalIssuesFixed: this.totalIssuesFixed,
      taskStatuses,
      watchdogAlive: this.watchdogTimer !== null,
      lastWatchdogCheck: this.lastWatchdogCheck,
    };
  }
  
  /**
   * 获取最近的执行历史
   */
  getRecentHistory(limit: number = 20): TaskExecutionRecord[] {
    return this.executionHistory.slice(-limit);
  }
  
  // ==================== 内部方法 ====================
  
  private scheduleTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task || !task.enabled || !this.running) return;
    
    // 首次执行延迟（避免启动时所有任务同时运行）
    const initialDelay = this.getStaggeredDelay(taskId);
    
    const timer = setTimeout(async () => {
      await this.executeTask(task);
      
      // 重新调度（使用正常间隔）
      if (this.running && task.enabled) {
        this.scheduleNextRun(taskId);
      }
    }, initialDelay);
    
    this.timers.set(taskId, timer);
  }
  
  private scheduleNextRun(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task || !task.enabled || !this.running) return;
    
    const timer = setTimeout(async () => {
      await this.executeTask(task);
      
      if (this.running && task.enabled) {
        this.scheduleNextRun(taskId);
      }
    }, task.intervalMs);
    
    this.timers.set(taskId, timer);
  }
  
  private async executeTask(task: HealingTask): Promise<HealingTaskResult> {
    const status = this.taskStatuses.get(task.id)!;
    const startTime = new Date();
    
    log.info(`[SelfHealingScheduler] 执行任务: ${task.id} (${task.name}), 级别=${task.level}`);
    
    try {
      // 修复级别的任务需要获取互斥锁
      let release: (() => void) | null = null;
      if (task.level === 'repair' || task.level === 'emergency') {
        // v360+v424: 检查主同步是否正在进行，避免自愈修复与主同步冲突
        // v424: 同时检查dataSyncScheduler和unifiedSyncEngine两个层面的同步状态
        try {
          const { isSyncRunning } = await import('../sync/dataSyncScheduler');
          if (typeof isSyncRunning === 'function' && isSyncRunning()) {
            log.info(`[SelfHealingScheduler] v424: dataSyncScheduler同步正在进行，延迟任务${task.id}执行`);
            return { success: true, issuesFound: 0, issuesFixed: 0, details: 'v424: dataSyncScheduler同步进行中，延迟执行' };
          }
        } catch {
          // isSyncRunning不可用时不影响正常流程
        }
        try {
          const { getEngineStatus } = await import('../sync/unifiedSyncEngine');
          const engineStatus = getEngineStatus();
          if (engineStatus.currentlyRunning && engineStatus.currentlyRunning.length > 0) {
            log.info(`[SelfHealingScheduler] v424: unifiedSyncEngine有 ${engineStatus.currentlyRunning.length} 个活跃同步，延迟任务${task.id}执行`);
            return { success: true, issuesFound: 0, issuesFixed: 0, details: 'v424: unifiedSyncEngine同步进行中，延迟执行' };
          }
        } catch {
          // unifiedSyncEngine不可用时不影响正常流程
        }
        
        release = await this.repairMutex.tryAcquire(task.timeoutMs);
        if (!release) {
          log.warn(`[SelfHealingScheduler] 任务${task.id}无法获取修复锁，跳过本次执行`);
          return { success: false, issuesFound: 0, issuesFixed: 0, details: '修复锁被占用' };
        }
      }
      
      try {
        // 带超时执行
        const result = await Promise.race([
          task.execute(),
          new Promise<HealingTaskResult>((_, reject) => 
            setTimeout(() => reject(new Error(`任务${task.id}执行超时(${task.timeoutMs}ms)`)), task.timeoutMs)
          ),
        ]);
        
        // 更新状态
        status.lastRun = new Date();
        status.lastResult = result;
        status.totalRuns++;
        status.consecutiveFailures = result.success ? 0 : status.consecutiveFailures + 1;
        
        this.totalExecutions++;
        this.totalIssuesFound += result.issuesFound;
        this.totalIssuesFixed += result.issuesFixed;
        
        // 记录执行历史
        const record: TaskExecutionRecord = {
          taskId: task.id,
          startTime,
          endTime: new Date(),
          durationMs: Date.now() - startTime.getTime(),
          result,
        };
        this.executionHistory.push(record);
        if (this.executionHistory.length > 100) {
          this.executionHistory = this.executionHistory.slice(-50);
        }
        
        log.info(`[SelfHealingScheduler] 任务${task.id}完成: 成功=${result.success}, 发现=${result.issuesFound}, 修复=${result.issuesFixed}, 耗时=${record.durationMs}ms`);
        
        // 检查是否需要升级
        if (result.escalate) {
          log.warn(`[SelfHealingScheduler] 任务${task.id}请求升级: ${result.escalateReason}`);
          await this.handleEscalation(task, result);
        }
        
        // 检查是否需要自动禁用
        if (task.disableOnConsecutiveFailures && 
            status.consecutiveFailures >= task.disableOnConsecutiveFailures) {
          log.warn(`[SelfHealingScheduler] 任务${task.id}连续失败${status.consecutiveFailures}次，自动禁用`);
          this.setTaskEnabled(task.id, false);
        }
        
        return result;
      } finally {
        if (release) release();
      }
    } catch (error: unknown) {
      const errorMsg = (error as Error).message;
      status.lastRun = new Date();
      status.consecutiveFailures++;
      status.totalRuns++;
      
      this.totalExecutions++;
      
      const record: TaskExecutionRecord = {
        taskId: task.id,
        startTime,
        endTime: new Date(),
        durationMs: Date.now() - startTime.getTime(),
        result: { success: false, issuesFound: 0, issuesFixed: 0, details: errorMsg },
        error: errorMsg,
      };
      this.executionHistory.push(record);
      
      log.warn(`[SelfHealingScheduler] 任务${task.id}执行异常: ${errorMsg}`);
      
      return { success: false, issuesFound: 0, issuesFixed: 0, details: errorMsg };
    }
  }
  
  /**
   * 处理任务升级请求
   * 当低级别任务发现严重问题时，触发更高级别的修复
   * v360: 添加升级连锁保护，防止升级风暴
   */
  private escalationCooldowns: Map<string, number> = new Map();
  private static readonly ESCALATION_COOLDOWN_MS = 10 * 60 * 1000; // 10分钟内不重复升级
  
  private async handleEscalation(sourceTask: HealingTask, result: HealingTaskResult): Promise<void> {
    // v360: 升级冷却保护 - 防止同一任务短时间内反复触发升级
    const lastEscalation = this.escalationCooldowns.get(sourceTask.id) || 0;
    if (Date.now() - lastEscalation < SelfHealingScheduler.ESCALATION_COOLDOWN_MS) {
      log.info(`[SelfHealingScheduler] 升级冷却中: ${sourceTask.id} 在${Math.round((SelfHealingScheduler.ESCALATION_COOLDOWN_MS - (Date.now() - lastEscalation)) / 1000)}秒内不会再次升级`);
      return;
    }
    this.escalationCooldowns.set(sourceTask.id, Date.now());
    
    // 查找比当前任务级别更高的修复任务
    const levelOrder = ['probe', 'check', 'repair', 'emergency'];
    const currentLevelIndex = levelOrder.indexOf(sourceTask.level);
    
    for (const [taskId, task] of this.tasks.entries()) {
      const taskLevelIndex = levelOrder.indexOf(task.level);
      if (taskLevelIndex > currentLevelIndex && task.enabled) {
        log.info(`[SelfHealingScheduler] 升级触发: ${sourceTask.id} -> ${taskId} (原因: ${result.escalateReason})`);
        // 异步触发，不阻塞当前任务
        this.executeTask(task).catch((err: any) => {
          log.warn(`[SelfHealingScheduler] 升级任务${taskId}执行失败: ${(err as Error).message}`);
        });
        break; // 只触发下一级
      }
    }
  }
  
  /**
   * 看门狗 - 确保调度器自身不会静默死亡
   */
  private startWatchdog(): void {
    const WATCHDOG_INTERVAL = 5 * 60 * 1000; // 每5分钟检查一次
    
    this.watchdogTimer = setInterval(() => {
      this.lastWatchdogCheck = new Date();
      
      // 检查所有启用的任务是否在预期时间内执行过
      for (const [taskId, task] of this.tasks.entries()) {
        if (!task.enabled) continue;
        
        const status = this.taskStatuses.get(taskId);
        if (!status) continue;
        
        if (status.lastRun) {
          const timeSinceLastRun = Date.now() - status.lastRun.getTime();
          const expectedMaxInterval = task.intervalMs * 3; // 允许3倍间隔的容差
          
          if (timeSinceLastRun > expectedMaxInterval) {
            log.warn(`[Watchdog] 任务${taskId}可能已停止! 上次运行: ${status.lastRun.toISOString()}, 已过${Math.round(timeSinceLastRun / 1000)}秒`);
            
            // 尝试重新调度
            if (this.running) {
              log.info(`[Watchdog] 尝试重新调度任务: ${taskId}`);
              const existingTimer = this.timers.get(taskId);
              if (existingTimer) clearTimeout(existingTimer);
              this.scheduleTask(taskId);
            }
          }
        }
      }
      
      // 检查活跃定时器数量
      const activeTimers = this.timers.size;
      const enabledTasks = Array.from(this.tasks.values()).filter(t => t.enabled).length;
      
      if (activeTimers < enabledTasks && this.running) {
        log.warn(`[Watchdog] 活跃定时器(${activeTimers})少于启用任务(${enabledTasks})，可能有任务丢失`);
      }
      
      log.debug(`[Watchdog] 检查完成: 运行中=${this.running}, 活跃定时器=${activeTimers}, 启用任务=${enabledTasks}`);
    }, WATCHDOG_INTERVAL);
  }
  
  /**
   * 计算错开的初始延迟，避免所有任务同时启动
   */
  private getStaggeredDelay(taskId: string): number {
    const taskIds = Array.from(this.tasks.keys());
    const index = taskIds.indexOf(taskId);
    return (index + 1) * 10000; // 每个任务间隔10秒启动
  }
}

// ==================== 默认自愈任务工厂 ====================

/**
 * 创建并配置默认的自愈调度器
 * 包含4个层级的自愈任务
 */
export function createDefaultSelfHealingScheduler(): SelfHealingScheduler {
  const scheduler = new SelfHealingScheduler();
  
  // Level 1: 探针 - 每5分钟检查同步心跳
  scheduler.registerTask({
    id: 'sync-heartbeat-probe',
    name: '同步心跳探针',
    level: 'probe',
    intervalMs: 5 * 60 * 1000,
    timeoutMs: 30 * 1000,
    enabled: true,
    execute: async () => {
      try {
        const { getDb } = await import('../db');
        const database = await getDb();
        if (!database) {
          return { success: false, issuesFound: 1, issuesFixed: 0, details: '数据库连接失败', escalate: true, escalateReason: '数据库不可用' };
        }
        
        const { sql } = await import('drizzle-orm');
        
        // v380: 两级探测策略
        // 第一级: 检查最近90分钟是否有任何同步记录（避免系统重启后误报）
        // 第二级: 检查最近30分钟的同步健康度
        const [recentJobs90, recentJobs30] = await Promise.all([
          database.execute(sql`
            SELECT COUNT(*) as total
            FROM data_sync_jobs 
            WHERE createdAt > DATE_SUB(NOW(), INTERVAL 90 MINUTE)
          `),
          database.execute(sql`
            SELECT COUNT(*) as total, 
                   SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as success_count,
                   SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as fail_count
            FROM data_sync_jobs 
            WHERE createdAt > DATE_SUB(NOW(), INTERVAL 30 MINUTE)
          `),
        ]);
        
        const row90 = (recentJobs90 as unknown[][])?.[0]?.[0] as Record<string, number> || {};
        const total90 = Number(row90.total || 0);
        
        const row30 = (recentJobs30 as unknown[][])?.[0]?.[0] as Record<string, number> || {};
        const total30 = Number(row30.total || 0);
        const failCount30 = Number(row30.fail_count || 0);
        
        // 如果90分钟内都没有同步记录，才升级告警
        if (total90 === 0) {
          return { 
            success: true, issuesFound: 1, issuesFixed: 0, 
            details: '最近90分钟无同步记录',
            escalate: true, escalateReason: '同步可能已停止'
          };
        }
        
        // 30分钟内无记录但有更早的记录，可能在同步间隔内，不升级
        if (total30 === 0 && total90 > 0) {
          return { 
            success: true, issuesFound: 0, issuesFixed: 0, 
            details: `最近30分钟无同步记录，但90分钟内有${total90}条记录，同步间隔正常`
          };
        }
        
        if (failCount30 > 0 && failCount30 === total30) {
          return { 
            success: true, issuesFound: failCount30, issuesFixed: 0, 
            details: `最近30分钟${total30}次同步全部失败`,
            escalate: true, escalateReason: '同步全部失败'
          };
        }
        
        return { success: true, issuesFound: 0, issuesFixed: 0, details: `同步正常: ${total30 - failCount30}/${total30}成功 (90min内共${total90}条)` };
      } catch (error: unknown) {
        return { success: false, issuesFound: 1, issuesFixed: 0, details: (error as Error).message };
      }
    },
  });
  
  // Level 2: 检查 - 每30分钟检查数据新鲜度
  scheduler.registerTask({
    id: 'data-freshness-check',
    name: '数据新鲜度检查',
    level: 'check',
    intervalMs: 30 * 60 * 1000,
    timeoutMs: 2 * 60 * 1000,
    enabled: true,
    execute: async () => {
      try {
        const { getDb } = await import('../db');
        const database = await getDb();
        if (!database) {
          return { success: false, issuesFound: 1, issuesFixed: 0, details: '数据库连接失败' };
        }
        
        const { sql } = await import('drizzle-orm');
        
        // 检查各核心表的最新数据时间
        // v360: 使用白名单表名替代sql.raw拼接，避免SQL注入风险
        const CORE_TABLES = ['campaigns', 'ad_groups', 'keywords', 'daily_performance'] as const;
        let staleCount = 0;
        const details: string[] = [];
        
        for (const table of CORE_TABLES) {
          try {
            // v360: 使用参数化查询，表名通过白名单确保安全
            const safeQuery = table === 'campaigns' ? sql`SELECT MAX(updatedAt) as latest FROM campaigns LIMIT 1`
              : table === 'ad_groups' ? sql`SELECT MAX(updatedAt) as latest FROM ad_groups LIMIT 1`
              : table === 'keywords' ? sql`SELECT MAX(updatedAt) as latest FROM keywords LIMIT 1`
              : sql`SELECT MAX(updatedAt) as latest FROM daily_performance LIMIT 1`;
            const result = await database.execute(safeQuery);
            const latest = (result as unknown[][])?.[0]?.[0] as Record<string, unknown>;
            const latestTime = latest?.latest as string;
            
            if (latestTime) {
              const hoursSinceUpdate = (Date.now() - new Date(latestTime).getTime()) / (1000 * 60 * 60);
              if (hoursSinceUpdate > 4) {
                staleCount++;
                details.push(`${table}: ${hoursSinceUpdate.toFixed(1)}小时未更新`);
              }
            }
          } catch (_: any) {
            // 表可能不存在，忽略
          }
        }
        
        return { 
          success: true, 
          issuesFound: staleCount, 
          issuesFixed: 0, 
          details: staleCount > 0 ? details.join('; ') : '所有核心表数据新鲜',
          escalate: staleCount >= 3,
          escalateReason: staleCount >= 3 ? `${staleCount}个核心表数据过期` : undefined,
        };
      } catch (error: unknown) {
        return { success: false, issuesFound: 1, issuesFixed: 0, details: (error as Error).message };
      }
    },
  });
  
  // Level 3: 修复 - 每4小时执行数据完整性检查和自动修复
  scheduler.registerTask({
    id: 'integrity-repair',
    name: '数据完整性修复',
    level: 'repair',
    intervalMs: 4 * 60 * 60 * 1000,
    timeoutMs: 10 * 60 * 1000,
    enabled: true,
    disableOnConsecutiveFailures: 5,
    execute: async () => {
      try {
        const { checkAllAccountsIntegrity, executeAutoRepair } = await import('../sync/infrastructure/dataIntegrityChecker');
        
        const checkResult = await checkAllAccountsIntegrity(14);
        const unhealthyResults = checkResult.results.filter(r => r.needsRepair);
        
        let totalFixed = 0;
        const errors: string[] = [];
        
        for (const result of unhealthyResults) {
          try {
            const repairResult = await executeAutoRepair(result);
            if (repairResult.repaired) totalFixed++;
            errors.push(...repairResult.errors);
          } catch (err: unknown) {
            errors.push(`账户${result.accountId}: ${(err as Error).message}`);
          }
        }
        
        return {
          success: errors.length === 0,
          issuesFound: unhealthyResults.length,
          issuesFixed: totalFixed,
          details: `总计${checkResult.totalAccounts}账户, 健康=${checkResult.healthyAccounts}, 需修复=${checkResult.unhealthyAccounts}, 已修复=${totalFixed}`,
        };
      } catch (error: unknown) {
        return { success: false, issuesFound: 0, issuesFixed: 0, details: (error as Error).message };
      }
    },
  });
  
  // Level 3.5: v440 数据健康巡检 - 每小时检查核心表ID格式规范
  scheduler.registerTask({
    id: 'data-id-health-check',
    name: 'v440 核心表ID格式巡检',
    level: 'check',
    intervalMs: 60 * 60 * 1000, // 每小时一次
    timeoutMs: 60 * 1000,
    enabled: true,
    execute: async () => {
      try {
        const { getDb } = await import('../db');
        const database = await getDb();
        if (!database) {
          return { success: false, issuesFound: 1, issuesFixed: 0, details: '数据库连接失败' };
        }
        
        const { sql } = await import('drizzle-orm');
        let totalIssues = 0;
        const issueDetails: string[] = [];
        
        // 检查 1: daily_performance 中是否有短 campaignId（本地ID泄漏）
        const [dpShortIds] = await database.execute(sql`
          SELECT COUNT(*) as cnt FROM daily_performance 
          WHERE campaignId IS NOT NULL AND LENGTH(campaignId) < 8
        `);
        // @ts-ignore
        const dpCount = Number((dpShortIds as unknown)?.[0]?.cnt || 0);
        if (dpCount > 0) {
          totalIssues += dpCount;
          issueDetails.push(`daily_performance: ${dpCount}条短 campaignId`);
        }
        
        // 检查 2: keyword_placement_hourly_performance 中是否有短 campaignId
        const [kphShortIds] = await database.execute(sql`
 SELECT COUNT(*) as cnt FROM keyword_placement_hourly_performance 
 WHERE campaign_id IS NOT NULL AND LENGTH(campaign_id) < 8
 `);
        // @ts-ignore
        const kphCount = Number((kphShortIds as unknown)?.[0]?.cnt || 0);
        if (kphCount > 0) {
          totalIssues += kphCount;
          issueDetails.push(`keyword_placement_hourly_performance: ${kphCount}条短 campaignId`);
        }
        
        // 检查 3: campaigns 表中是否有短 campaignId
        const [campShortIds] = await database.execute(sql`
 SELECT COUNT(*) as cnt FROM campaigns 
 WHERE campaignId IS NOT NULL AND LENGTH(campaignId) < 8
 `);
        // @ts-ignore
        const campCount = Number((campShortIds as unknown)?.[0]?.cnt || 0);
        if (campCount > 0) {
          totalIssues += campCount;
          issueDetails.push(`campaigns: ${campCount}条短 campaignId`);
        }
        
        // 检查 4: ad_groups 表中是否有短 adGroupId
        const [agShortIds] = await database.execute(sql`
 SELECT COUNT(*) as cnt FROM ad_groups 
 WHERE adGroupId IS NOT NULL AND LENGTH(adGroupId) < 8
 `);
        // @ts-ignore
        const agCount = Number((agShortIds as unknown)?.[0]?.cnt || 0);
        if (agCount > 0) {
          totalIssues += agCount;
          issueDetails.push(`ad_groups: ${agCount}条短 adGroupId`);
        }
        
        // 检查 5: product_targets 中是否有 NULL accountId
        // @ts-ignore
        const [ptNullAccount] = await database.execute(sql`
          SELECT COUNT(*) as cnt FROM product_targets 
          WHERE accountId IS NULL
        `);
        // @ts-ignore
        const ptCount = Number((ptNullAccount as unknown)?.[0]?.cnt || 0);
        if (ptCount > 0) {
          totalIssues += ptCount;
          issueDetails.push(`product_targets: ${ptCount}条NULL accountId`);
        }
        
        // 检查 6: placement_performance 中是否有短 campaignId
        const [ppShortIds] = await database.execute(sql`
          SELECT COUNT(*) as cnt FROM placement_performance 
          WHERE campaignId IS NOT NULL AND LENGTH(campaignId) < 8
        `);
        // @ts-ignore
        const ppCount = Number((ppShortIds as unknown)?.[0]?.cnt || 0);
        if (ppCount > 0) {
          totalIssues += ppCount;
          issueDetails.push(`placement_performance: ${ppCount}条短 campaignId`);
        }
        
        // 检查 7: search_terms 中是否有短 campaignId
        const [stShortIds] = await database.execute(sql`
          SELECT COUNT(*) as cnt FROM search_terms 
          WHERE campaignId IS NOT NULL AND LENGTH(campaignId) < 8
        `);
        // @ts-ignore
        const stCount = Number((stShortIds as unknown)?.[0]?.cnt || 0);
        if (stCount > 0) {
          totalIssues += stCount;
          issueDetails.push(`search_terms: ${stCount}条短 campaignId`);
        }
        
        if (totalIssues > 0) {
          log.warn(`[DataHealthCheck] ⛔ 发现${totalIssues}条ID格式异常: ${issueDetails.join('; ')}`);
          return {
            success: false,
            issuesFound: totalIssues,
            issuesFixed: 0,
            details: `ID格式异常: ${issueDetails.join('; ')}`,
            escalate: true,
            escalateReason: `发现${totalIssues}条本地ID泄漏到核心表`,
          };
        }
        
        return {
          success: true,
          issuesFound: 0,
          issuesFixed: 0,
          details: '所有核心表ID格式正常',
        };
      } catch (error: unknown) {
        return { success: false, issuesFound: 1, issuesFixed: 0, details: `巡检异常: ${(error as Error).message}` };
      }
    },
  });
  
  // Level 4: 紧急 - 数据库连接池健康检查（按需触发）
  scheduler.registerTask({
    id: 'emergency-db-check',
    name: '紧急数据库健康检查',
    level: 'emergency',
    intervalMs: 24 * 60 * 60 * 1000, // 正常情况下每天一次
    timeoutMs: 30 * 1000,
    enabled: true,
    execute: async () => {
      try {
        const { getDb } = await import('../db');
        const database = await getDb();
        if (!database) {
          return { success: false, issuesFound: 1, issuesFixed: 0, details: '数据库连接池不可用' };
        }
        
        const { sql } = await import('drizzle-orm');
        
        // 执行简单查询验证连接
        const pingResult = await database.execute(sql`SELECT 1 as ping`);
        if (!pingResult) {
          return { success: false, issuesFound: 1, issuesFixed: 0, details: '数据库ping失败' };
        }
        
        // 检查连接池状态
        const processResult = await database.execute(sql`SHOW PROCESSLIST`);
        const activeConnections = Array.isArray(processResult?.[0]) ? processResult[0].length : 0;
        
        return {
          success: true,
          issuesFound: 0,
          issuesFixed: 0,
          details: `数据库健康, 活跃连接=${activeConnections}`,
        };
      } catch (error: unknown) {
        return { success: false, issuesFound: 1, issuesFixed: 0, details: (error as Error).message };
      }
    },
  });
  
  return scheduler;
}

// ==================== 全局实例 ====================

let globalScheduler: SelfHealingScheduler | null = null;

/**
 * 获取全局自愈调度器实例
 */
export function getSelfHealingScheduler(): SelfHealingScheduler {
  if (!globalScheduler) {
    globalScheduler = createDefaultSelfHealingScheduler();
  }
  return globalScheduler;
}

/**
 * 启动全局自愈调度器
 */
export function startSelfHealing(): void {
  const scheduler = getSelfHealingScheduler();
  scheduler.start();
  log.info('[SelfHealingScheduler] v359: 全局自愈调度器已启动');
}

/**
 * 停止全局自愈调度器
 */
export function stopSelfHealing(): void {
  if (globalScheduler) {
    globalScheduler.stop();
    log.info('[SelfHealingScheduler] v359: 全局自愈调度器已停止');
  }
}
