/**
 * 任务生命周期工具模块
 * 
 * 从 deployLifecycleManager.ts 中提取的轻量级工具函数，
 * 供优化引擎模块（optimizationTargetEngine、optimizationSyncEngine等）使用。
 * 
 * 提取目的：打破 deployLifecycleManager <-> optimizationSyncEngine/optimizationTargetEngine 的循环依赖。
 * deployLifecycleManager 仍然是完整的生命周期管理器，但这些被广泛引用的工具函数
 * 现在位于独立模块中，避免下游模块直接依赖 deployLifecycleManager。
 */

// 关闭状态
interface ShutdownState {
  isShuttingDown: boolean;
  shutdownStartedAt: Date | null;
  shutdownReason: string | null;
  activeTaskCount: number;
}

const shutdownState: ShutdownState = {
  isShuttingDown: false,
  shutdownStartedAt: null,
  shutdownReason: null,
  activeTaskCount: 0,
};

// 活跃任务追踪
const activeTasks = new Map<string, {
  description: string;
  startedAt: Date;
  targetId?: number;
  accountId?: number;
  module?: string;
}>();

/**
 * 注册一个活跃任务（在优化操作开始时调用）
 * @returns 任务ID，用于后续注销
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

/**
 * 标记系统开始关闭（由 deployLifecycleManager 调用）
 */
export function markShuttingDown(reason: string): void {
  shutdownState.isShuttingDown = true;
  shutdownState.shutdownStartedAt = new Date();
  shutdownState.shutdownReason = reason;
}

/**
 * 获取所有活跃任务的描述（用于关闭等待日志）
 */
export function getActiveTaskDescriptions(): string[] {
  return Array.from(activeTasks.values()).map(t => t.description);
}

/**
 * 等待所有活跃任务完成
 */
export async function waitForActiveTasks(maxWaitMs: number = 30000): Promise<boolean> {
  if (activeTasks.size === 0) return true;
  
  const startTime = Date.now();
  while (activeTasks.size > 0 && (Date.now() - startTime) < maxWaitMs) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return activeTasks.size === 0;
}
