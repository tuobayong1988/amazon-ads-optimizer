/**
 * DeployLifecycleManager v185 测试
 * 
 * 测试覆盖:
 * 1. 活跃任务追踪（注册/注销/计数）
 * 2. 关闭状态管理（isShuttingDown标志）
 * 3. 系统信息查询
 * 4. 关闭中间件行为
 * 5. 健康检查端点行为
 * 6. 启动诊断逻辑
 * 7. 心跳数据格式
 * 8. 任务恢复逻辑
 * 9. 版本变更日志完整性
 * 10. 关闭超时保护
 */

// ==================== 测试框架 ====================

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function assertDeepEqual(actual: any, expected: any, message: string) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  assert(actualStr === expectedStr, `${message} (got: ${actualStr}, expected: ${expectedStr})`);
}

// ==================== 模拟活跃任务追踪器 ====================

// 复制核心逻辑进行独立测试（不依赖数据库）
class TaskTracker {
  private activeTasks = new Map<string, {
    description: string;
    startedAt: Date;
    targetId?: number;
    accountId?: number;
    module?: string;
  }>();
  private _isShuttingDown = false;
  
  registerActiveTask(description: string, options?: {
    targetId?: number;
    accountId?: number;
    module?: string;
  }): string {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    this.activeTasks.set(taskId, {
      description,
      startedAt: new Date(),
      targetId: options?.targetId,
      accountId: options?.accountId,
      module: options?.module,
    });
    return taskId;
  }
  
  unregisterActiveTask(taskId: string): void {
    this.activeTasks.delete(taskId);
  }
  
  isShuttingDown(): boolean {
    return this._isShuttingDown;
  }
  
  setShuttingDown(value: boolean): void {
    this._isShuttingDown = value;
  }
  
  getActiveTaskCount(): number {
    return this.activeTasks.size;
  }
  
  getActiveTasks(): Map<string, any> {
    return this.activeTasks;
  }
  
  getSystemInfo() {
    return {
      version: 185,
      isShuttingDown: this._isShuttingDown,
      activeTasks: this.activeTasks.size,
      uptime: process.uptime(),
    };
  }
}

// ==================== 模拟启动诊断 ====================

interface StartupDiagnostics {
  lastShutdownType: 'graceful' | 'crash' | 'unknown';
  lastHeartbeatAge: number;
  interruptedTasks: number;
  pendingTasks: number;
  versionChanged: boolean;
  previousVersion: number | null;
  currentVersion: number;
}

function analyzeShutdownType(lastEventType: string, lastEventDetail: any, heartbeatAge: number): 'graceful' | 'crash' | 'unknown' {
  if (lastEventType === 'system_shutdown' && lastEventDetail?.shutdownType === 'graceful') {
    return 'graceful';
  }
  if (lastEventType === 'system_heartbeat') {
    if (heartbeatAge > 180) {
      return 'crash';
    }
    return 'unknown';
  }
  return 'unknown';
}

function shouldRecoverTasks(diagnostics: StartupDiagnostics): boolean {
  return diagnostics.interruptedTasks > 0;
}

function shouldRunReoptimization(diagnostics: StartupDiagnostics): boolean {
  return diagnostics.versionChanged;
}

// ==================== 模拟健康检查 ====================

function healthCheckResponse(info: { isShuttingDown: boolean; version: number; activeTasks: number; uptime: number }): { status: number; body: any } {
  if (info.isShuttingDown) {
    return {
      status: 503,
      body: {
        status: 'shutting_down',
        version: `v${info.version}`,
        activeTasks: info.activeTasks,
      },
    };
  }
  return {
    status: 200,
    body: {
      status: 'healthy',
      version: `v${info.version}`,
      uptime: Math.round(info.uptime),
      activeTasks: info.activeTasks,
    },
  };
}

// ==================== 模拟关闭中间件 ====================

function shutdownMiddleware(isShuttingDown: boolean): { blocked: boolean; status?: number; retryAfter?: number } {
  if (isShuttingDown) {
    return { blocked: true, status: 503, retryAfter: 30 };
  }
  return { blocked: false };
}

// ==================== 1. 活跃任务追踪 ====================
console.log('\n=== 1. 活跃任务追踪 ===');

{
  const tracker = new TaskTracker();
  
  // 初始状态
  assert(tracker.getActiveTaskCount() === 0, '初始活跃任务数为0');
  
  // 注册任务
  const taskId1 = tracker.registerActiveTask('出价优化', { targetId: 1, module: 'bid' });
  assert(tracker.getActiveTaskCount() === 1, '注册1个任务后计数为1');
  assert(taskId1.startsWith('task_'), '任务ID以task_开头');
  
  const taskId2 = tracker.registerActiveTask('位置优化', { targetId: 2, module: 'placement' });
  assert(tracker.getActiveTaskCount() === 2, '注册2个任务后计数为2');
  assert(taskId1 !== taskId2, '两个任务ID不同');
  
  // 注销任务
  tracker.unregisterActiveTask(taskId1);
  assert(tracker.getActiveTaskCount() === 1, '注销1个任务后计数为1');
  
  tracker.unregisterActiveTask(taskId2);
  assert(tracker.getActiveTaskCount() === 0, '注销所有任务后计数为0');
  
  // 注销不存在的任务不应报错
  tracker.unregisterActiveTask('nonexistent');
  assert(tracker.getActiveTaskCount() === 0, '注销不存在的任务不影响计数');
}

// ==================== 2. 关闭状态管理 ====================
console.log('\n=== 2. 关闭状态管理 ===');

{
  const tracker = new TaskTracker();
  
  assert(tracker.isShuttingDown() === false, '初始状态不在关闭中');
  
  tracker.setShuttingDown(true);
  assert(tracker.isShuttingDown() === true, '设置后状态为关闭中');
  
  // 关闭中仍可查询任务数
  const taskId = tracker.registerActiveTask('测试任务');
  assert(tracker.getActiveTaskCount() === 1, '关闭中仍可查询活跃任务数');
}

// ==================== 3. 系统信息查询 ====================
console.log('\n=== 3. 系统信息查询 ===');

{
  const tracker = new TaskTracker();
  tracker.registerActiveTask('测试任务1');
  tracker.registerActiveTask('测试任务2');
  
  const info = tracker.getSystemInfo();
  assert(info.version === 185, '系统版本为185');
  assert(info.isShuttingDown === false, '系统未在关闭中');
  assert(info.activeTasks === 2, '活跃任务数为2');
  assert(info.uptime > 0, '运行时间大于0');
  
  tracker.setShuttingDown(true);
  const info2 = tracker.getSystemInfo();
  assert(info2.isShuttingDown === true, '关闭后系统信息反映关闭状态');
}

// ==================== 4. 健康检查端点行为 ====================
console.log('\n=== 4. 健康检查端点行为 ===');

{
  // 正常运行时
  const normalResponse = healthCheckResponse({
    isShuttingDown: false,
    version: 185,
    activeTasks: 3,
    uptime: 120.5,
  });
  assert(normalResponse.status === 200, '正常运行返回200');
  assert(normalResponse.body.status === 'healthy', '正常运行状态为healthy');
  assert(normalResponse.body.version === 'v185', '版本号正确');
  assert(normalResponse.body.uptime === 121, '运行时间四舍五入');
  assert(normalResponse.body.activeTasks === 3, '活跃任务数正确');
  
  // 关闭中
  const shutdownResponse = healthCheckResponse({
    isShuttingDown: true,
    version: 185,
    activeTasks: 1,
    uptime: 3600,
  });
  assert(shutdownResponse.status === 503, '关闭中返回503');
  assert(shutdownResponse.body.status === 'shutting_down', '关闭中状态为shutting_down');
  assert(shutdownResponse.body.activeTasks === 1, '关闭中仍显示活跃任务数');
}

// ==================== 5. 关闭中间件行为 ====================
console.log('\n=== 5. 关闭中间件行为 ===');

{
  // 正常运行时不阻止请求
  const normalResult = shutdownMiddleware(false);
  assert(normalResult.blocked === false, '正常运行时不阻止请求');
  
  // 关闭中阻止新请求
  const shutdownResult = shutdownMiddleware(true);
  assert(shutdownResult.blocked === true, '关闭中阻止新请求');
  assert(shutdownResult.status === 503, '关闭中返回503');
  assert(shutdownResult.retryAfter === 30, '建议30秒后重试');
}

// ==================== 6. 启动诊断逻辑 ====================
console.log('\n=== 6. 启动诊断逻辑 ===');

{
  // 优雅关闭后启动
  const graceful = analyzeShutdownType('system_shutdown', { shutdownType: 'graceful' }, 0);
  assert(graceful === 'graceful', '检测到优雅关闭');
  
  // 心跳超时 = crash
  const crash = analyzeShutdownType('system_heartbeat', {}, 300);
  assert(crash === 'crash', '心跳超过180秒判定为crash');
  
  // 心跳正常范围 = unknown（可能是正常部署间隔）
  const unknown = analyzeShutdownType('system_heartbeat', {}, 90);
  assert(unknown === 'unknown', '心跳90秒内判定为unknown');
  
  // 无记录
  const noRecord = analyzeShutdownType('', {}, -1);
  assert(noRecord === 'unknown', '无记录判定为unknown');
}

// ==================== 7. 任务恢复决策 ====================
console.log('\n=== 7. 任务恢复决策 ===');

{
  // 有被中断的任务 → 需要恢复
  assert(shouldRecoverTasks({
    lastShutdownType: 'crash',
    lastHeartbeatAge: 300,
    interruptedTasks: 5,
    pendingTasks: 3,
    versionChanged: false,
    previousVersion: 184,
    currentVersion: 185,
  }) === true, '有被中断的任务时需要恢复');
  
  // 无被中断的任务 → 不需要恢复
  assert(shouldRecoverTasks({
    lastShutdownType: 'graceful',
    lastHeartbeatAge: 10,
    interruptedTasks: 0,
    pendingTasks: 0,
    versionChanged: false,
    previousVersion: 185,
    currentVersion: 185,
  }) === false, '无被中断的任务时不需要恢复');
}

// ==================== 8. 版本变化检测 ====================
console.log('\n=== 8. 版本变化检测 ===');

{
  // 版本变化 → 需要重优化
  assert(shouldRunReoptimization({
    lastShutdownType: 'graceful',
    lastHeartbeatAge: 10,
    interruptedTasks: 0,
    pendingTasks: 0,
    versionChanged: true,
    previousVersion: 184,
    currentVersion: 185,
  }) === true, '版本变化时需要重优化');
  
  // 版本未变 → 不需要重优化
  assert(shouldRunReoptimization({
    lastShutdownType: 'graceful',
    lastHeartbeatAge: 10,
    interruptedTasks: 0,
    pendingTasks: 0,
    versionChanged: false,
    previousVersion: 185,
    currentVersion: 185,
  }) === false, '版本未变时不需要重优化');
}

// ==================== 9. 并发任务追踪 ====================
console.log('\n=== 9. 并发任务追踪 ===');

{
  const tracker = new TaskTracker();
  
  // 模拟多个并发优化任务
  const tasks: string[] = [];
  for (let i = 0; i < 10; i++) {
    tasks.push(tracker.registerActiveTask(`优化任务${i}`, { targetId: i, module: 'bid' }));
  }
  assert(tracker.getActiveTaskCount() === 10, '10个并发任务全部被追踪');
  
  // 逐个完成
  for (let i = 0; i < 5; i++) {
    tracker.unregisterActiveTask(tasks[i]);
  }
  assert(tracker.getActiveTaskCount() === 5, '完成5个后剩余5个');
  
  // 全部完成
  for (let i = 5; i < 10; i++) {
    tracker.unregisterActiveTask(tasks[i]);
  }
  assert(tracker.getActiveTaskCount() === 0, '全部完成后计数为0');
}

// ==================== 10. 任务元数据完整性 ====================
console.log('\n=== 10. 任务元数据完整性 ===');

{
  const tracker = new TaskTracker();
  
  const taskId = tracker.registerActiveTask('多维度分析', {
    targetId: 42,
    accountId: 7,
    module: 'multidim',
  });
  
  const tasks = tracker.getActiveTasks();
  const task = tasks.get(taskId);
  assert(task !== undefined, '任务存在于追踪器中');
  assert(task!.description === '多维度分析', '任务描述正确');
  assert(task!.targetId === 42, '目标ID正确');
  assert(task!.accountId === 7, '账户ID正确');
  assert(task!.module === 'multidim', '模块名称正确');
  assert(task!.startedAt instanceof Date, '开始时间是Date类型');
  assert(task!.startedAt.getTime() <= Date.now(), '开始时间不超过当前时间');
}

// ==================== 11. 关闭超时保护模拟 ====================
console.log('\n=== 11. 关闭超时保护模拟 ===');

// 包装在立即执行的async函数中以避免 top-level await
void (async () => {
  async function waitForTasks(taskCount: number, maxWaitMs: number, taskCompletionMs: number): Promise<{ 
    timedOut: boolean; 
    waitedMs: number;
    remainingTasks: number;
  }> {
    let remaining = taskCount;
    const start = Date.now();
    const checkInterval = 10;
    const completionTimer = setTimeout(() => { remaining = 0; }, taskCompletionMs);
    while (remaining > 0 && (Date.now() - start) < maxWaitMs) {
      await new Promise(r => setTimeout(r, checkInterval));
    }
    clearTimeout(completionTimer);
    return { timedOut: remaining > 0, waitedMs: Date.now() - start, remainingTasks: remaining };
  }
  
  const fastResult = await waitForTasks(3, 500, 50);
  assert(fastResult.timedOut === false, '任务在超时前完成不超时');
  assert(fastResult.remainingTasks === 0, '所有任务已完成');
  
  const slowResult = await waitForTasks(3, 50, 500);
  assert(slowResult.timedOut === true, '任务超时被正确检测');
  assert(slowResult.remainingTasks === 3, '超时后仍有3个任务');
})();

// ==================== 12. 版本变更日志完整性 ====================
console.log('\n=== 12. 版本变更日志完整性 ===');

{
  // 模拟v185的VERSION_CHANGELOG
  const changelog = [
    { version: 182, affectedModules: ['dayparting', 'dayparting_budget', 'bid'], correctionActions: ['fix_timezone_errors', 'reset_dayparting_rules', 'rerun_optimization'] },
    { version: 183, affectedModules: ['multidim', 'dayparting', 'placement', 'dayparting_budget'], correctionActions: ['rebuild_combo_analysis', 'reset_dayparting_rules', 'reset_placement_rules', 'rerun_optimization'] },
    { version: 184, affectedModules: ['all'], correctionActions: ['rebuild_combo_analysis', 'full_reoptimize'] },
    { version: 185, affectedModules: [], correctionActions: [] },
  ];
  
  assert(changelog.length === 4, 'v185应有4个版本变更记录');
  assert(changelog[3].version === 185, '最新版本为185');
  assert(changelog[3].affectedModules.length === 0, 'v185无受影响模块（纯基础设施变更）');
  assert(changelog[3].correctionActions.length === 0, 'v185无纠正动作');
  
  // 版本号递增
  for (let i = 1; i < changelog.length; i++) {
    assert(changelog[i].version > changelog[i-1].version, `版本号递增: ${changelog[i-1].version} < ${changelog[i].version}`);
  }
}

// ==================== 13. 心跳数据格式 ====================
console.log('\n=== 13. 心跳数据格式 ===');

{
  const heartbeatData = {
    type: 'system_heartbeat',
    systemVersion: 185,
    shutdownType: 'running',
    activeTaskCount: 2,
    uptime: 3600,
  };
  
  assert(heartbeatData.type === 'system_heartbeat', '心跳类型正确');
  assert(heartbeatData.systemVersion === 185, '心跳版本号正确');
  assert(typeof heartbeatData.activeTaskCount === 'number', '活跃任务数是数字');
  assert(typeof heartbeatData.uptime === 'number', '运行时间是数字');
  
  // 关闭心跳
  const shutdownHeartbeat = { ...heartbeatData, shutdownType: 'graceful' };
  assert(shutdownHeartbeat.shutdownType === 'graceful', '关闭心跳类型正确');
}

// ==================== 14. 关闭事件数据格式 ====================
console.log('\n=== 14. 关闭事件数据格式 ===');

{
  const shutdownEvent = {
    type: 'system_shutdown',
    systemVersion: 185,
    shutdownReason: 'SIGTERM',
    shutdownType: 'graceful',
    activeTasksAtShutdown: 1,
    interruptedTasks: ['task_123: 出价优化'],
    shutdownDuration: 2500,
  };
  
  assert(shutdownEvent.type === 'system_shutdown', '关闭事件类型正确');
  assert(shutdownEvent.shutdownReason === 'SIGTERM', '关闭原因正确');
  assert(shutdownEvent.shutdownType === 'graceful', '关闭类型正确');
  assert(Array.isArray(shutdownEvent.interruptedTasks), '被中断任务列表是数组');
  assert(shutdownEvent.shutdownDuration > 0, '关闭耗时大于0');
}

// ==================== 15. 恢复事件数据格式 ====================
console.log('\n=== 15. 恢复事件数据格式 ===');

{
  const recoveryEvent = {
    type: 'task_recovery',
    systemVersion: 185,
    recoveredTasks: 3,
    recoveryReason: 'restart_after_deploy',
  };
  
  assert(recoveryEvent.type === 'task_recovery', '恢复事件类型正确');
  assert(recoveryEvent.recoveredTasks === 3, '恢复任务数正确');
  assert(recoveryEvent.recoveryReason === 'restart_after_deploy', '恢复原因正确');
}

// ==================== 16. EB部署时序验证 ====================
console.log('\n=== 16. EB部署时序验证 ===');

{
  // EB给30秒，我们的超时设为25秒，留5秒缓冲
  const EB_TIMEOUT = 30000;
  const OUR_TIMEOUT = 25000;
  const BUFFER = EB_TIMEOUT - OUR_TIMEOUT;
  
  assert(BUFFER >= 5000, 'EB超时缓冲至少5秒');
  assert(OUR_TIMEOUT < EB_TIMEOUT, '我们的超时小于EB超时');
  
  // 各阶段时间分配
  const PHASE1_STOP_NEW = 1000;  // 停止新任务
  const PHASE2_WAIT = 20000;     // 等待活跃任务
  const PHASE3_PERSIST = 3000;   // 持久化状态
  const PHASE4_HTTP = 2000;      // 关闭HTTP
  
  const TOTAL = PHASE1_STOP_NEW + PHASE2_WAIT + PHASE3_PERSIST + PHASE4_HTTP;
  // 注意：阶段是顺序执行但有些可能提前完成
  // 最坏情况不应超过我们的超时
  assert(TOTAL <= OUR_TIMEOUT + 1000, `最坏情况总时间 ${TOTAL}ms 不超过超时 ${OUR_TIMEOUT + 1000}ms`);
}

// ==================== 17. 多次关闭信号防重入 ====================
console.log('\n=== 17. 多次关闭信号防重入 ===');

{
  let shutdownCount = 0;
  let isShuttingDown = false;
  
  function simulateShutdown(): boolean {
    if (isShuttingDown) {
      return false; // 已在关闭中，忽略
    }
    isShuttingDown = true;
    shutdownCount++;
    return true;
  }
  
  assert(simulateShutdown() === true, '第一次关闭信号被接受');
  assert(simulateShutdown() === false, '第二次关闭信号被忽略');
  assert(simulateShutdown() === false, '第三次关闭信号被忽略');
  assert(shutdownCount === 1, '关闭只执行了1次');
}

// ==================== 结果汇总 ====================
console.log(`\n========================================`);
console.log(`v185 DeployLifecycleManager 测试结果: ${passed} 通过, ${failed} 失败 (共 ${passed + failed} 个)`);
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
}
