#!/usr/bin/env node
// @ts-nocheck
/**
 * P5: Worker Process - 微服务拆分入口
 * 
 * 独立的后台任务处理进程，与 Web 服务器物理隔离。
 * 当 P5_WORKER_ENABLED=true 时，主进程跳过以下后台任务，
 * 由本 Worker 进程独立运行：
 * 
 * - ReportJobScheduler: 异步报告任务的提交/轮询/处理
 * - AutoStopLoss: 周期性止损扫描
 * - Reconciliation: 竞价/预算同步校验
 * - AutoCorrector: 自动纠错
 * - PendingEventProcessor: 优化事件处理
 * 
 * 通过 Redis pub/sub 与 Web 进程通信。
 * 通过 systemd 管理进程生命周期（.platform/hooks 配置）。
 */

// 设置 Worker 进程标识（必须在导入其他模块之前设置）
process.env.P5_IS_WORKER = 'true';
process.env.P5_WORKER_PID = String(process.pid);

const WORKER_MODE = process.env.P5_WORKER_MODE || 'all';

console.log(`[P5:Worker] ====================================`);
console.log(`[P5:Worker] Starting worker process`);
console.log(`[P5:Worker] PID: ${process.pid}`);
console.log(`[P5:Worker] Mode: ${WORKER_MODE}`);
console.log(`[P5:Worker] Node: ${process.version}`);
console.log(`[P5:Worker] ====================================`);

async function startWorker(): Promise<void> {
  // v641: 全局未捕获异常处理 — 防止Worker进程崩溃
  process.on('uncaughtException', (error: Error) => {
    console.error(`[P5:Worker] v641: 未捕获异常 (Worker继续运行): ${error.message}`);
    console.error(error.stack);
    const mem = process.memoryUsage();
    console.error(`[P5:Worker] v641: 异常时内存: heap=${Math.round(mem.heapUsed / 1024 / 1024)}MB, rss=${Math.round(mem.rss / 1024 / 1024)}MB`);
  });
  process.on('unhandledRejection', (reason: unknown) => {
    console.error(`[P5:Worker] v641: 未处理的Promise拒绝 (Worker继续运行): ${reason instanceof Error ? reason.message : String(reason)}`);
  });

  try {
    // 动态导入数据库模块
    console.log('[P5:Worker] Initializing database connection...');
    const { getDb } = await import('./db');
    const db = await getDb();
    if (!db) {
      throw new Error('Failed to initialize database connection');
    }
    console.log('[P5:Worker] Database connected');

    // 初始化 Redis
    console.log('[P5:Worker] Initializing Redis connection...');
    try {
      const { ensureRedis, isRedisAvailable } = await import('./utils/redisClient');
      await ensureRedis();
      console.log(`[P5:Worker] Redis: ${isRedisAvailable() ? 'connected' : 'not available (will use DB fallback)'}`);
    } catch (redisErr: unknown) {
      console.warn(`[P5:Worker] Redis init warning: ${(redisErr as Error).message}`);
    }

    // 启动 ReportJobScheduler
    console.log('[P5:Worker] Starting ReportJobScheduler...');
    const { reportJobScheduler } = await import('./services/reportJobScheduler');
    await reportJobScheduler.start();
    console.log('[P5:Worker] ReportJobScheduler started');

    // 启动 AutoStopLoss
    if (WORKER_MODE === 'all' || WORKER_MODE === 'autostoploss') {
      console.log('[P5:Worker] Starting AutoStopLoss scheduler...');
      try {
        const autoStopLossModule = await import('./optimization/autoStopLoss');
        if (typeof autoStopLossModule.startAutoStopLossScheduler === 'function') {
          autoStopLossModule.startAutoStopLossScheduler();
          console.log('[P5:Worker] AutoStopLoss scheduler started');
        } else {
          console.log('[P5:Worker] AutoStopLoss scheduler function not found, skipping');
        }
      } catch (aslErr: unknown) {
        console.warn(`[P5:Worker] AutoStopLoss init warning: ${(aslErr as Error).message}`);
      }
    }

    // 启动 Reconciliation
    if (WORKER_MODE === 'all' || WORKER_MODE === 'reconciliation') {
      console.log('[P5:Worker] Starting Reconciliation scheduler...');
      try {
        const reconcileModule = await import('./sync/reconciliation');
        if (typeof reconcileModule.startReconciliationScheduler === 'function') {
          reconcileModule.startReconciliationScheduler();
          console.log('[P5:Worker] Reconciliation scheduler started');
        } else {
          console.log('[P5:Worker] Reconciliation scheduler function not found, skipping');
        }
      } catch (recErr: unknown) {
        console.warn(`[P5:Worker] Reconciliation init warning: ${(recErr as Error).message}`);
      }
    }

    // 启动 AutoCorrector
    if (WORKER_MODE === 'all' || WORKER_MODE === 'autocorrector') {
      console.log('[P5:Worker] Starting AutoCorrector scheduler...');
      try {
        const autoCorrectModule = await import('./sync/autoCorrector');
        if (typeof autoCorrectModule.startAutoCorrectScheduler === 'function') {
          autoCorrectModule.startAutoCorrectScheduler();
          console.log('[P5:Worker] AutoCorrector scheduler started');
        } else {
          console.log('[P5:Worker] AutoCorrector scheduler function not found, skipping');
        }
      } catch (acErr: unknown) {
        console.warn(`[P5:Worker] AutoCorrector init warning: ${(acErr as Error).message}`);
      }
    }

    console.log('[P5:Worker] ====================================');
    console.log('[P5:Worker] All services started successfully');
    console.log('[P5:Worker] ====================================');

    // v641: 增强健康心跳（每5分钟）— 添加内存泄漏检测和自动GC
    let lastHeapMB = 0;
    let consecutiveGrowth = 0;
    setInterval(() => {
      const mem = process.memoryUsage();
      const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
      const rssMB = Math.round(mem.rss / 1024 / 1024);
      const uptimeMin = Math.round(process.uptime() / 60);
      console.log(`[P5:Worker] Heartbeat: heap=${heapMB}MB, rss=${rssMB}MB, uptime=${uptimeMin}min`);
      
      // v641: 内存泄漏检测 — 连续5次心跳堆内存增长则触发GC
      if (heapMB > lastHeapMB) {
        consecutiveGrowth++;
      } else {
        consecutiveGrowth = 0;
      }
      lastHeapMB = heapMB;
      
      if (consecutiveGrowth >= 5 && typeof global.gc === 'function') {
        console.warn(`[P5:Worker] v641: 内存连续增长${consecutiveGrowth}次，触发手动GC (heap=${heapMB}MB)`);
        global.gc();
        consecutiveGrowth = 0;
      }
      
      // v641: 内存超过3GB时发出警告
      if (heapMB > 3072) {
        console.error(`[P5:Worker] v641: ❗ 内存警告! heap=${heapMB}MB 超过3GB阈值，可能存在内存泄漏`);
      }
    }, 300000);

    // 优雅关闭
    const shutdown = (signal: string) => {
      console.log(`[P5:Worker] Received ${signal}, shutting down gracefully...`);
      reportJobScheduler.stop();
      setTimeout(() => {
        console.log('[P5:Worker] Shutdown complete');
        process.exit(0);
      }, 5000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (err: unknown) {
    console.error(`[P5:Worker] Fatal error: ${(err as Error).message}`);
    console.error((err as Error).stack);
    // 等待日志刷新后退出
    setTimeout(() => process.exit(1), 2000);
  }
}

startWorker();
