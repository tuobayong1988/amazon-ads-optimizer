// Extracted from production dist/index.js
// Original module: server/services/reportJobScheduler.ts
// Lines: 201

var log84, SCHEDULER_CONFIG, ReportJobScheduler, reportJobScheduler;
var init_reportJobScheduler = __esm({
  "server/services/reportJobScheduler.ts"() {
    "use strict";
    init_asyncReportService();
    init_logger();
    init_opsLogger();
    log84 = createModuleLogger("ReportJobScheduler");
    SCHEDULER_CONFIG = {
      // v596: Redis分布式任务队列 - 提交任务间隔（毫秒）
      submitInterval: 10 * 1e3,
      // 10秒 - Redis队列更高效，可以更频繁轮询
      // v596: 检查状态间隔（毫秒）
      checkInterval: 20 * 1e3,
      // 20秒 - 缩短检查间隔加速报告完成检测
      // v596: 处理完成报告间隔（毫秒）
      processInterval: 10 * 1e3,
      // 10秒 - 加速数据入库
      // 清理过期任务间隔（毫秒）
      cleanupInterval: 12 * 60 * 60 * 1e3,
      // 12小时 - 更频繁清理
      // v596: 每批次处理的任务数 - Redis队列支持更大批次
      batchSize: {
        submit: 80,
        check: 80,
        process: 30
      }
    };
    ReportJobScheduler = class {
      static {
        __name(this, "ReportJobScheduler");
      }
      submitTimer = null;
      checkTimer = null;
      processTimer = null;
      cleanupTimer = null;
      isRunning = false;
      /**
       * 启动调度器
       */
      start() {
        if (this.isRunning) {
          log84.debug("[ReportJobScheduler] Already running");
          return;
        }
        this.isRunning = true;
        log84.info("[ReportJobScheduler] Starting...");
        logSystem("ReportJobScheduler", "\u62A5\u544A\u4EFB\u52A1\u8C03\u5EA6\u5668\u542F\u52A8");
        this.submitTimer = setInterval(async () => {
          try {
            // v596: Redis分布式锁防止多实例重复提交
            const { getRedis: getRedis2, isRedisAvailable: isRedisAvailable2 } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
            if (isRedisAvailable2()) {
              const redis = getRedis2();
              if (redis) {
                const lockKey = "report:scheduler:submit:lock";
                const acquired = await redis.set(lockKey, process.pid.toString(), "EX", 8, "NX");
                if (!acquired) {
                  log84.debug("[ReportJobScheduler] v596: 另一个实例正在提交报告任务，跳过");
                  return;
                }
              }
            }
            const count11 = await asyncReportService.submitPendingJobs(SCHEDULER_CONFIG.batchSize.submit);
            if (count11 > 0) {
              log84.info(`[ReportJobScheduler] v596: Submitted ${count11} jobs (Redis-coordinated)`);
              logSync("ReportJobScheduler", `\u63D0\u4EA4${count11}\u4E2A\u62A5\u544A\u4EFB\u52A1`, { count: count11 });
              // v596: 发布Redis事件通知其他消费者
              if (isRedisAvailable2()) {
                const redis = getRedis2();
                if (redis) {
                  await redis.publish("report:jobs:submitted", JSON.stringify({ count: count11, timestamp: Date.now() })).catch(() => {});
                }
              }
            }
          } catch (error48) {
            log84.warn("[ReportJobScheduler] Submit error:", error48.message);
            logSyncError("ReportJobScheduler", `\u63D0\u4EA4\u62A5\u544A\u4EFB\u52A1\u5931\u8D25`, { error: error48.message });
          }
        }, SCHEDULER_CONFIG.submitInterval);
        this.checkTimer = setInterval(async () => {
          try {
            // v596: Redis分布式锁防止多实例重复检查
            try {
              const { getRedis: _rds2, isRedisAvailable: _rdsOk2 } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
              if (_rdsOk2() && _rds2()) {
                const _lock2 = await _rds2().set("report:scheduler:check:lock", process.pid.toString(), "EX", 15, "NX");
                if (!_lock2) { log84.debug("[ReportJobScheduler] v596: 另一个实例正在检查报告状态，跳过"); return; }
              }
            } catch(_lockErr2) {}
            const result = await asyncReportService.checkSubmittedJobs(SCHEDULER_CONFIG.batchSize.check);
            if (result.completed > 0 || result.failed > 0) {
              log84.info(`[ReportJobScheduler] v596: Check result: ${result.completed} completed, ${result.failed} failed, ${result.pending} pending (Redis-coordinated)`);
              logSync("ReportJobScheduler", `\u68C0\u67E5\u62A5\u544A\u72B6\u6001`, { completed: result.completed, failed: result.failed, pending: result.pending });
              // P5e: Queue depth alert
              if (result.pending > 50) {
                log84.warn(`[P5e:QueueAlert] High report queue depth: ${result.pending} pending jobs - consider scaling`);
              }
            }
          } catch (error48) {
            log84.warn("[ReportJobScheduler] Check error:", error48.message);
            logSyncError("ReportJobScheduler", `\u68C0\u67E5\u62A5\u544A\u72B6\u6001\u5931\u8D25`, { error: error48.message });
          }
        }, SCHEDULER_CONFIG.checkInterval);
        this.processTimer = setInterval(async () => {
          try {
            // v596: Redis分布式锁防止多实例重复处理
            try {
              const { getRedis: _rds3, isRedisAvailable: _rdsOk3 } = await Promise.resolve().then(() => (init_redisClient(), redisClient_exports));
              if (_rdsOk3() && _rds3()) {
                const _lock3 = await _rds3().set("report:scheduler:process:lock", process.pid.toString(), "EX", 8, "NX");
                if (!_lock3) { log84.debug("[ReportJobScheduler] v596: 另一个实例正在处理报告，跳过"); return; }
              }
            } catch(_lockErr3) {}
            const count11 = await asyncReportService.processCompletedJobs(SCHEDULER_CONFIG.batchSize.process);
            if (count11 > 0) {
              log84.info(`[ReportJobScheduler] v596: Processed ${count11} jobs (Redis-coordinated)`);
              logSync("ReportJobScheduler", `\u5904\u7406${count11}\u4E2A\u5DF2\u5B8C\u6210\u62A5\u544A`, { count: count11 });
            }
          } catch (error48) {
            log84.warn("[ReportJobScheduler] Process error:", error48.message);
            logSyncError("ReportJobScheduler", `\u5904\u7406\u62A5\u544A\u5931\u8D25`, { error: error48.message });
          }
        }, SCHEDULER_CONFIG.processInterval);
        this.cleanupTimer = setInterval(async () => {
          try {
            const count11 = await asyncReportService.cleanupExpiredJobs(7);
            if (count11 > 0) {
              log84.info(`[ReportJobScheduler] Cleaned up ${count11} expired jobs`);
              logSync("ReportJobScheduler", `\u6E05\u7406${count11}\u4E2A\u8FC7\u671F\u4EFB\u52A1`, { count: count11 });
            }
          } catch (error48) {
            log84.warn("[ReportJobScheduler] Cleanup error:", error48.message);
            logSyncError("ReportJobScheduler", `\u6E05\u7406\u8FC7\u671F\u4EFB\u52A1\u5931\u8D25`, { error: error48.message });
          }
        }, SCHEDULER_CONFIG.cleanupInterval);
        log84.info("[ReportJobScheduler] Started successfully");
        logSystem("ReportJobScheduler", "\u62A5\u544A\u4EFB\u52A1\u8C03\u5EA6\u5668\u542F\u52A8\u5B8C\u6210");
      }
      /**
       * 停止调度器
       */
      stop() {
        if (!this.isRunning) {
          log84.debug("[ReportJobScheduler] Not running");
          return;
        }
        if (this.submitTimer) {
          clearInterval(this.submitTimer);
          this.submitTimer = null;
        }
        if (this.checkTimer) {
          clearInterval(this.checkTimer);
          this.checkTimer = null;
        }
        if (this.processTimer) {
          clearInterval(this.processTimer);
          this.processTimer = null;
        }
        if (this.cleanupTimer) {
          clearInterval(this.cleanupTimer);
          this.cleanupTimer = null;
        }
        this.isRunning = false;
        log84.info("[ReportJobScheduler] Stopped");
        logSystem("ReportJobScheduler", "\u62A5\u544A\u4EFB\u52A1\u8C03\u5EA6\u5668\u5DF2\u505C\u6B62");
      }
      /**
       * 获取调度器状态
       */
      getStatus() {
        return { isRunning: this.isRunning };
      }
      /**
       * 手动触发一次完整的处理周期
       */
      async runOnce() {
        log84.info("[ReportJobScheduler] Running manual cycle...");
        const submitted = await asyncReportService.submitPendingJobs(SCHEDULER_CONFIG.batchSize.submit);
        const checked = await asyncReportService.checkSubmittedJobs(SCHEDULER_CONFIG.batchSize.check);
        const processed = await asyncReportService.processCompletedJobs(SCHEDULER_CONFIG.batchSize.process);
        log84.info(`[ReportJobScheduler] Manual cycle complete: submitted=${submitted}, checked=${JSON.stringify(checked)}, processed=${processed}`);
        logSync("ReportJobScheduler", `\u624B\u52A8\u5468\u671F\u5B8C\u6210`, { submitted, checked, processed });
        return { submitted, checked, processed };
      }
    };
    reportJobScheduler = new ReportJobScheduler();
    // P5e: ReportJobScheduler respects worker mode
    const _origStart = reportJobScheduler.start.bind(reportJobScheduler);
    const _origStartFn = reportJobScheduler.start;
    reportJobScheduler.start = function() {
      const _p5eWorkerActive = process.env.P5_WORKER_ENABLED === "true" && !process.env.P5_IS_WORKER;
      if (_p5eWorkerActive) {
        log84.info("[P5e] ReportJobScheduler delegated to worker process, skipping in web process");
        return;
      }
      return _origStart();
    };
  }
});

