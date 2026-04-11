// Extracted from production dist/index.js
// Original module: server/services/selfHealingScheduler.ts
// Lines: 636

var selfHealingScheduler_exports = {};
__export(selfHealingScheduler_exports, {
  SelfHealingScheduler: () => SelfHealingScheduler,
  createDefaultSelfHealingScheduler: () => createDefaultSelfHealingScheduler,
  getSelfHealingScheduler: () => getSelfHealingScheduler,
  startSelfHealing: () => startSelfHealing,
  stopSelfHealing: () => stopSelfHealing
});
function createDefaultSelfHealingScheduler() {
  const scheduler2 = new SelfHealingScheduler();
  scheduler2.registerTask({
    id: "sync-heartbeat-probe",
    name: "\u540C\u6B65\u5FC3\u8DF3\u63A2\u9488",
    level: "probe",
    intervalMs: 5 * 60 * 1e3,
    timeoutMs: 30 * 1e3,
    enabled: true,
    execute: /* @__PURE__ */ __name(async () => {
      try {
        const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
        const database = await getDb3();
        if (!database) {
          return { success: false, issuesFound: 1, issuesFixed: 0, details: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25", escalate: true, escalateReason: "\u6570\u636E\u5E93\u4E0D\u53EF\u7528" };
        }
        const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
        const [recentJobs90, recentJobs30] = await Promise.all([
          database.execute(sql15`
            SELECT COUNT(*) as total
            FROM data_sync_jobs 
            WHERE createdAt > DATE_SUB(NOW(), INTERVAL 90 MINUTE)
          `),
          database.execute(sql15`
            SELECT COUNT(*) as total, 
                   SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as success_count,
                   SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as fail_count
            FROM data_sync_jobs 
            WHERE createdAt > DATE_SUB(NOW(), INTERVAL 30 MINUTE)
          `)
        ]);
        const row90 = recentJobs90?.[0]?.[0] || {};
        const total90 = Number(row90.total || 0);
        const row30 = recentJobs30?.[0]?.[0] || {};
        const total30 = Number(row30.total || 0);
        const failCount30 = Number(row30.fail_count || 0);
        if (total90 === 0) {
          return {
            success: true,
            issuesFound: 1,
            issuesFixed: 0,
            details: "\u6700\u8FD190\u5206\u949F\u65E0\u540C\u6B65\u8BB0\u5F55",
            escalate: true,
            escalateReason: "\u540C\u6B65\u53EF\u80FD\u5DF2\u505C\u6B62"
          };
        }
        if (total30 === 0 && total90 > 0) {
          return {
            success: true,
            issuesFound: 0,
            issuesFixed: 0,
            details: `\u6700\u8FD130\u5206\u949F\u65E0\u540C\u6B65\u8BB0\u5F55\uFF0C\u4F4690\u5206\u949F\u5185\u6709${total90}\u6761\u8BB0\u5F55\uFF0C\u540C\u6B65\u95F4\u9694\u6B63\u5E38`
          };
        }
        if (failCount30 > 0 && failCount30 === total30) {
          return {
            success: true,
            issuesFound: failCount30,
            issuesFixed: 0,
            details: `\u6700\u8FD130\u5206\u949F${total30}\u6B21\u540C\u6B65\u5168\u90E8\u5931\u8D25`,
            escalate: true,
            escalateReason: "\u540C\u6B65\u5168\u90E8\u5931\u8D25"
          };
        }
        return { success: true, issuesFound: 0, issuesFixed: 0, details: `\u540C\u6B65\u6B63\u5E38: ${total30 - failCount30}/${total30}\u6210\u529F (90min\u5185\u5171${total90}\u6761)` };
      } catch (error48) {
        return { success: false, issuesFound: 1, issuesFixed: 0, details: error48.message };
      }
    }, "execute")
  });
  scheduler2.registerTask({
    id: "data-freshness-check",
    name: "\u6570\u636E\u65B0\u9C9C\u5EA6\u68C0\u67E5",
    level: "check",
    intervalMs: 30 * 60 * 1e3,
    timeoutMs: 2 * 60 * 1e3,
    enabled: true,
    execute: /* @__PURE__ */ __name(async () => {
      try {
        const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
        const database = await getDb3();
        if (!database) {
          return { success: false, issuesFound: 1, issuesFixed: 0, details: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25" };
        }
        const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
        const CORE_TABLES = ["campaigns", "ad_groups", "keywords", "daily_performance"];
        let staleCount = 0;
        const details = [];
        for (const table of CORE_TABLES) {
          try {
            const safeQuery = table === "campaigns" ? sql15`SELECT MAX(updatedAt) as latest FROM campaigns LIMIT 1` : table === "ad_groups" ? sql15`SELECT MAX(updatedAt) as latest FROM ad_groups LIMIT 1` : table === "keywords" ? sql15`SELECT MAX(updatedAt) as latest FROM keywords LIMIT 1` : sql15`SELECT MAX(updatedAt) as latest FROM daily_performance LIMIT 1`;
            const result = await database.execute(safeQuery);
            const latest = result?.[0]?.[0];
            const latestTime = latest?.latest;
            if (latestTime) {
              const hoursSinceUpdate = (Date.now() - new Date(latestTime).getTime()) / (1e3 * 60 * 60);
              if (hoursSinceUpdate > 4) {
                staleCount++;
                details.push(`${table}: ${hoursSinceUpdate.toFixed(1)}\u5C0F\u65F6\u672A\u66F4\u65B0`);
              }
            }
          } catch (_) {
          }
        }
        return {
          success: true,
          issuesFound: staleCount,
          issuesFixed: 0,
          details: staleCount > 0 ? details.join("; ") : "\u6240\u6709\u6838\u5FC3\u8868\u6570\u636E\u65B0\u9C9C",
          escalate: staleCount >= 3,
          escalateReason: staleCount >= 3 ? `${staleCount}\u4E2A\u6838\u5FC3\u8868\u6570\u636E\u8FC7\u671F` : void 0
        };
      } catch (error48) {
        return { success: false, issuesFound: 1, issuesFixed: 0, details: error48.message };
      }
    }, "execute")
  });
  scheduler2.registerTask({
    id: "integrity-repair",
    name: "\u6570\u636E\u5B8C\u6574\u6027\u4FEE\u590D",
    level: "repair",
    intervalMs: 4 * 60 * 60 * 1e3,
    timeoutMs: 10 * 60 * 1e3,
    enabled: true,
    disableOnConsecutiveFailures: 5,
    execute: /* @__PURE__ */ __name(async () => {
      try {
        const { checkAllAccountsIntegrity: checkAllAccountsIntegrity2, executeAutoRepair: executeAutoRepair2 } = await Promise.resolve().then(() => (init_dataIntegrityChecker(), dataIntegrityChecker_exports));
        const checkResult = await checkAllAccountsIntegrity2(14);
        const unhealthyResults = checkResult.results.filter((r) => r.needsRepair);
        let totalFixed = 0;
        const errors = [];
        for (const result of unhealthyResults) {
          try {
            const repairResult = await executeAutoRepair2(result);
            if (repairResult.repaired) totalFixed++;
            errors.push(...repairResult.errors);
          } catch (err) {
            errors.push(`\u8D26\u6237${result.accountId}: ${err.message}`);
          }
        }
        return {
          success: errors.length === 0,
          issuesFound: unhealthyResults.length,
          issuesFixed: totalFixed,
          details: `\u603B\u8BA1${checkResult.totalAccounts}\u8D26\u6237, \u5065\u5EB7=${checkResult.healthyAccounts}, \u9700\u4FEE\u590D=${checkResult.unhealthyAccounts}, \u5DF2\u4FEE\u590D=${totalFixed}`
        };
      } catch (error48) {
        return { success: false, issuesFound: 0, issuesFixed: 0, details: error48.message };
      }
    }, "execute")
  });
  scheduler2.registerTask({
    id: "data-id-health-check",
    name: "v440 \u6838\u5FC3\u8868ID\u683C\u5F0F\u5DE1\u68C0",
    level: "check",
    intervalMs: 60 * 60 * 1e3,
    // 每小时一次
    timeoutMs: 60 * 1e3,
    enabled: true,
    execute: /* @__PURE__ */ __name(async () => {
      try {
        const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
        const database = await getDb3();
        if (!database) {
          return { success: false, issuesFound: 1, issuesFixed: 0, details: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25" };
        }
        const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
        let totalIssues = 0;
        const issueDetails = [];
        const [dpShortIds] = await database.execute(sql15`
          SELECT COUNT(*) as cnt FROM daily_performance 
          WHERE campaignId IS NOT NULL AND LENGTH(campaignId) < 8
        `);
        const dpCount = Number(dpShortIds?.[0]?.cnt || 0);
        if (dpCount > 0) {
          totalIssues += dpCount;
          issueDetails.push(`daily_performance: ${dpCount}\u6761\u77ED campaignId`);
        }
        const [kphShortIds] = await database.execute(sql15`
 SELECT COUNT(*) as cnt FROM keyword_placement_hourly_performance 
 WHERE campaign_id IS NOT NULL AND LENGTH(campaign_id) < 8
 `);
        const kphCount = Number(kphShortIds?.[0]?.cnt || 0);
        if (kphCount > 0) {
          totalIssues += kphCount;
          issueDetails.push(`keyword_placement_hourly_performance: ${kphCount}\u6761\u77ED campaignId`);
        }
        const [campShortIds] = await database.execute(sql15`
 SELECT COUNT(*) as cnt FROM campaigns 
 WHERE campaignId IS NOT NULL AND LENGTH(campaignId) < 8
 `);
        const campCount = Number(campShortIds?.[0]?.cnt || 0);
        if (campCount > 0) {
          totalIssues += campCount;
          issueDetails.push(`campaigns: ${campCount}\u6761\u77ED campaignId`);
        }
        const [agShortIds] = await database.execute(sql15`
 SELECT COUNT(*) as cnt FROM ad_groups 
 WHERE adGroupId IS NOT NULL AND LENGTH(adGroupId) < 8
 `);
        const agCount = Number(agShortIds?.[0]?.cnt || 0);
        if (agCount > 0) {
          totalIssues += agCount;
          issueDetails.push(`ad_groups: ${agCount}\u6761\u77ED adGroupId`);
        }
        const [ptNullAccount] = await database.execute(sql15`
          SELECT COUNT(*) as cnt FROM product_targets 
          WHERE accountId IS NULL
        `);
        const ptCount = Number(ptNullAccount?.[0]?.cnt || 0);
        if (ptCount > 0) {
          totalIssues += ptCount;
          issueDetails.push(`product_targets: ${ptCount}\u6761NULL accountId`);
        }
        const [ppShortIds] = await database.execute(sql15`
          SELECT COUNT(*) as cnt FROM placement_performance 
          WHERE campaignId IS NOT NULL AND LENGTH(campaignId) < 8
        `);
        const ppCount = Number(ppShortIds?.[0]?.cnt || 0);
        if (ppCount > 0) {
          totalIssues += ppCount;
          issueDetails.push(`placement_performance: ${ppCount}\u6761\u77ED campaignId`);
        }
        const [stShortIds] = await database.execute(sql15`
          SELECT COUNT(*) as cnt FROM search_terms 
          WHERE campaignId IS NOT NULL AND LENGTH(campaignId) < 8
        `);
        const stCount = Number(stShortIds?.[0]?.cnt || 0);
        if (stCount > 0) {
          totalIssues += stCount;
          issueDetails.push(`search_terms: ${stCount}\u6761\u77ED campaignId`);
        }
        if (totalIssues > 0) {
          log137.warn(`[DataHealthCheck] \u26D4 \u53D1\u73B0${totalIssues}\u6761ID\u683C\u5F0F\u5F02\u5E38: ${issueDetails.join("; ")}`);
          return {
            success: false,
            issuesFound: totalIssues,
            issuesFixed: 0,
            details: `ID\u683C\u5F0F\u5F02\u5E38: ${issueDetails.join("; ")}`,
            escalate: true,
            escalateReason: `\u53D1\u73B0${totalIssues}\u6761\u672C\u5730ID\u6CC4\u6F0F\u5230\u6838\u5FC3\u8868`
          };
        }
        return {
          success: true,
          issuesFound: 0,
          issuesFixed: 0,
          details: "\u6240\u6709\u6838\u5FC3\u8868ID\u683C\u5F0F\u6B63\u5E38"
        };
      } catch (error48) {
        return { success: false, issuesFound: 1, issuesFixed: 0, details: `\u5DE1\u68C0\u5F02\u5E38: ${error48.message}` };
      }
    }, "execute")
  });
  scheduler2.registerTask({
    id: "emergency-db-check",
    name: "\u7D27\u6025\u6570\u636E\u5E93\u5065\u5EB7\u68C0\u67E5",
    level: "emergency",
    intervalMs: 24 * 60 * 60 * 1e3,
    // 正常情况下每天一次
    timeoutMs: 30 * 1e3,
    enabled: true,
    execute: /* @__PURE__ */ __name(async () => {
      try {
        const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
        const database = await getDb3();
        if (!database) {
          return { success: false, issuesFound: 1, issuesFixed: 0, details: "\u6570\u636E\u5E93\u8FDE\u63A5\u6C60\u4E0D\u53EF\u7528" };
        }
        const { sql: sql15 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
        const pingResult = await database.execute(sql15`SELECT 1 as ping`);
        if (!pingResult) {
          return { success: false, issuesFound: 1, issuesFixed: 0, details: "\u6570\u636E\u5E93ping\u5931\u8D25" };
        }
        const processResult = await database.execute(sql15`SHOW PROCESSLIST`);
        const activeConnections = Array.isArray(processResult?.[0]) ? processResult[0].length : 0;
        return {
          success: true,
          issuesFound: 0,
          issuesFixed: 0,
          details: `\u6570\u636E\u5E93\u5065\u5EB7, \u6D3B\u8DC3\u8FDE\u63A5=${activeConnections}`
        };
      } catch (error48) {
        return { success: false, issuesFound: 1, issuesFixed: 0, details: error48.message };
      }
    }, "execute")
  });
  return scheduler2;
}
function getSelfHealingScheduler() {
  if (!globalScheduler) {
    globalScheduler = createDefaultSelfHealingScheduler();
  }
  return globalScheduler;
}
function startSelfHealing() {
  const scheduler2 = getSelfHealingScheduler();
  scheduler2.start();
  log137.info("[SelfHealingScheduler] v359: \u5168\u5C40\u81EA\u6108\u8C03\u5EA6\u5668\u5DF2\u542F\u52A8");
}
function stopSelfHealing() {
  if (globalScheduler) {
    globalScheduler.stop();
    log137.info("[SelfHealingScheduler] v359: \u5168\u5C40\u81EA\u6108\u8C03\u5EA6\u5668\u5DF2\u505C\u6B62");
  }
}
var log137, SelfHealingScheduler, globalScheduler;
var init_selfHealingScheduler = __esm({
  "server/services/selfHealingScheduler.ts"() {
    "use strict";
    init_logger();
    init_asyncMutex();
    log137 = createModuleLogger("SelfHealingScheduler");
    SelfHealingScheduler = class _SelfHealingScheduler {
      static {
        __name(this, "SelfHealingScheduler");
      }
      tasks = /* @__PURE__ */ new Map();
      timers = /* @__PURE__ */ new Map();
      executionHistory = [];
      taskStatuses = /* @__PURE__ */ new Map();
      running = false;
      startedAt = null;
      watchdogTimer = null;
      lastWatchdogCheck = null;
      totalExecutions = 0;
      totalIssuesFound = 0;
      totalIssuesFixed = 0;
      /** 全局互斥锁，防止多个修复任务同时执行 */
      repairMutex = new AsyncMutex("self-healing-repair");
      constructor() {
        log137.info("[SelfHealingScheduler] v359: \u521D\u59CB\u5316\u72EC\u7ACB\u81EA\u6108\u8C03\u5EA6\u5668");
      }
      /**
       * 注册自愈任务
       */
      registerTask(task) {
        this.tasks.set(task.id, task);
        this.taskStatuses.set(task.id, {
          lastRun: null,
          lastResult: null,
          consecutiveFailures: 0,
          totalRuns: 0,
          enabled: task.enabled
        });
        log137.info(`[SelfHealingScheduler] \u6CE8\u518C\u4EFB\u52A1: ${task.id} (${task.name}), \u7EA7\u522B=${task.level}, \u95F4\u9694=${task.intervalMs}ms`);
      }
      /**
       * 启动调度器
       */
      start() {
        if (this.running) {
          log137.warn("[SelfHealingScheduler] \u8C03\u5EA6\u5668\u5DF2\u5728\u8FD0\u884C\u4E2D");
          return;
        }
        this.running = true;
        this.startedAt = /* @__PURE__ */ new Date();
        for (const [taskId, task] of this.tasks.entries()) {
          if (task.enabled) {
            this.scheduleTask(taskId);
          }
        }
        this.startWatchdog();
        log137.info(`[SelfHealingScheduler] v359: \u8C03\u5EA6\u5668\u5DF2\u542F\u52A8, ${this.tasks.size}\u4E2A\u4EFB\u52A1\u5DF2\u6CE8\u518C`);
      }
      /**
       * 停止调度器
       */
      stop() {
        this.running = false;
        for (const [taskId, timer] of this.timers.entries()) {
          clearTimeout(timer);
          log137.info(`[SelfHealingScheduler] \u505C\u6B62\u4EFB\u52A1: ${taskId}`);
        }
        this.timers.clear();
        if (this.watchdogTimer) {
          clearInterval(this.watchdogTimer);
          this.watchdogTimer = null;
        }
        log137.info("[SelfHealingScheduler] v359: \u8C03\u5EA6\u5668\u5DF2\u505C\u6B62");
      }
      /**
       * 手动触发指定任务
       */
      async triggerTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) {
          log137.warn(`[SelfHealingScheduler] \u672A\u627E\u5230\u4EFB\u52A1: ${taskId}`);
          return null;
        }
        return this.executeTask(task);
      }
      /**
       * 启用/禁用任务
       */
      setTaskEnabled(taskId, enabled) {
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
          log137.info(`[SelfHealingScheduler] \u4EFB\u52A1${taskId} ${enabled ? "\u5DF2\u542F\u7528" : "\u5DF2\u7981\u7528"}`);
        }
      }
      /**
       * 获取调度器状态
       */
      getStatus() {
        const taskStatuses = {};
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
          lastWatchdogCheck: this.lastWatchdogCheck
        };
      }
      /**
       * 获取最近的执行历史
       */
      getRecentHistory(limit = 20) {
        return this.executionHistory.slice(-limit);
      }
      // ==================== 内部方法 ====================
      scheduleTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task || !task.enabled || !this.running) return;
        const initialDelay = this.getStaggeredDelay(taskId);
        const timer = setTimeout(async () => {
          await this.executeTask(task);
          if (this.running && task.enabled) {
            this.scheduleNextRun(taskId);
          }
        }, initialDelay);
        this.timers.set(taskId, timer);
      }
      scheduleNextRun(taskId) {
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
      async executeTask(task) {
        const status = this.taskStatuses.get(task.id);
        const startTime = /* @__PURE__ */ new Date();
        log137.info(`[SelfHealingScheduler] \u6267\u884C\u4EFB\u52A1: ${task.id} (${task.name}), \u7EA7\u522B=${task.level}`);
        try {
          let release = null;
          if (task.level === "repair" || task.level === "emergency") {
            try {
              const { isSyncRunning: isSyncRunning2 } = await Promise.resolve().then(() => (init_dataSyncScheduler(), dataSyncScheduler_exports));
              if (typeof isSyncRunning2 === "function" && isSyncRunning2()) {
                log137.info(`[SelfHealingScheduler] v424: dataSyncScheduler\u540C\u6B65\u6B63\u5728\u8FDB\u884C\uFF0C\u5EF6\u8FDF\u4EFB\u52A1${task.id}\u6267\u884C`);
                return { success: true, issuesFound: 0, issuesFixed: 0, details: "v424: dataSyncScheduler\u540C\u6B65\u8FDB\u884C\u4E2D\uFF0C\u5EF6\u8FDF\u6267\u884C" };
              }
            } catch {
            }
            try {
              const { getEngineStatus: getEngineStatus2 } = await Promise.resolve().then(() => (init_unifiedSyncEngine(), unifiedSyncEngine_exports));
              const engineStatus2 = getEngineStatus2();
              if (engineStatus2.currentlyRunning && engineStatus2.currentlyRunning.length > 0) {
                log137.info(`[SelfHealingScheduler] v424: unifiedSyncEngine\u6709 ${engineStatus2.currentlyRunning.length} \u4E2A\u6D3B\u8DC3\u540C\u6B65\uFF0C\u5EF6\u8FDF\u4EFB\u52A1${task.id}\u6267\u884C`);
                return { success: true, issuesFound: 0, issuesFixed: 0, details: "v424: unifiedSyncEngine\u540C\u6B65\u8FDB\u884C\u4E2D\uFF0C\u5EF6\u8FDF\u6267\u884C" };
              }
            } catch {
            }
            release = await this.repairMutex.tryAcquire(task.timeoutMs);
            if (!release) {
              log137.warn(`[SelfHealingScheduler] \u4EFB\u52A1${task.id}\u65E0\u6CD5\u83B7\u53D6\u4FEE\u590D\u9501\uFF0C\u8DF3\u8FC7\u672C\u6B21\u6267\u884C`);
              return { success: false, issuesFound: 0, issuesFixed: 0, details: "\u4FEE\u590D\u9501\u88AB\u5360\u7528" };
            }
          }
          try {
            const result = await Promise.race([
              task.execute(),
              new Promise(
                (_, reject) => setTimeout(() => reject(new Error(`\u4EFB\u52A1${task.id}\u6267\u884C\u8D85\u65F6(${task.timeoutMs}ms)`)), task.timeoutMs)
              )
            ]);
            status.lastRun = /* @__PURE__ */ new Date();
            status.lastResult = result;
            status.totalRuns++;
            status.consecutiveFailures = result.success ? 0 : status.consecutiveFailures + 1;
            this.totalExecutions++;
            this.totalIssuesFound += result.issuesFound;
            this.totalIssuesFixed += result.issuesFixed;
            const record2 = {
              taskId: task.id,
              startTime,
              endTime: /* @__PURE__ */ new Date(),
              durationMs: Date.now() - startTime.getTime(),
              result
            };
            this.executionHistory.push(record2);
            if (this.executionHistory.length > 100) {
              this.executionHistory = this.executionHistory.slice(-50);
            }
            log137.info(`[SelfHealingScheduler] \u4EFB\u52A1${task.id}\u5B8C\u6210: \u6210\u529F=${result.success}, \u53D1\u73B0=${result.issuesFound}, \u4FEE\u590D=${result.issuesFixed}, \u8017\u65F6=${record2.durationMs}ms`);
            if (result.escalate) {
              log137.warn(`[SelfHealingScheduler] \u4EFB\u52A1${task.id}\u8BF7\u6C42\u5347\u7EA7: ${result.escalateReason}`);
              await this.handleEscalation(task, result);
            }
            if (task.disableOnConsecutiveFailures && status.consecutiveFailures >= task.disableOnConsecutiveFailures) {
              log137.warn(`[SelfHealingScheduler] \u4EFB\u52A1${task.id}\u8FDE\u7EED\u5931\u8D25${status.consecutiveFailures}\u6B21\uFF0C\u81EA\u52A8\u7981\u7528`);
              this.setTaskEnabled(task.id, false);
            }
            return result;
          } finally {
            if (release) release();
          }
        } catch (error48) {
          const errorMsg = error48.message;
          status.lastRun = /* @__PURE__ */ new Date();
          status.consecutiveFailures++;
          status.totalRuns++;
          this.totalExecutions++;
          const record2 = {
            taskId: task.id,
            startTime,
            endTime: /* @__PURE__ */ new Date(),
            durationMs: Date.now() - startTime.getTime(),
            result: { success: false, issuesFound: 0, issuesFixed: 0, details: errorMsg },
            error: errorMsg
          };
          this.executionHistory.push(record2);
          log137.warn(`[SelfHealingScheduler] \u4EFB\u52A1${task.id}\u6267\u884C\u5F02\u5E38: ${errorMsg}`);
          return { success: false, issuesFound: 0, issuesFixed: 0, details: errorMsg };
        }
      }
      /**
       * 处理任务升级请求
       * 当低级别任务发现严重问题时，触发更高级别的修复
       * v360: 添加升级连锁保护，防止升级风暴
       */
      escalationCooldowns = /* @__PURE__ */ new Map();
      static ESCALATION_COOLDOWN_MS = 10 * 60 * 1e3;
      // 10分钟内不重复升级
      async handleEscalation(sourceTask, result) {
        const lastEscalation = this.escalationCooldowns.get(sourceTask.id) || 0;
        if (Date.now() - lastEscalation < _SelfHealingScheduler.ESCALATION_COOLDOWN_MS) {
          log137.info(`[SelfHealingScheduler] \u5347\u7EA7\u51B7\u5374\u4E2D: ${sourceTask.id} \u5728${Math.round((_SelfHealingScheduler.ESCALATION_COOLDOWN_MS - (Date.now() - lastEscalation)) / 1e3)}\u79D2\u5185\u4E0D\u4F1A\u518D\u6B21\u5347\u7EA7`);
          return;
        }
        this.escalationCooldowns.set(sourceTask.id, Date.now());
        const levelOrder = ["probe", "check", "repair", "emergency"];
        const currentLevelIndex = levelOrder.indexOf(sourceTask.level);
        for (const [taskId, task] of this.tasks.entries()) {
          const taskLevelIndex = levelOrder.indexOf(task.level);
          if (taskLevelIndex > currentLevelIndex && task.enabled) {
            log137.info(`[SelfHealingScheduler] \u5347\u7EA7\u89E6\u53D1: ${sourceTask.id} -> ${taskId} (\u539F\u56E0: ${result.escalateReason})`);
            this.executeTask(task).catch((err) => {
              log137.warn(`[SelfHealingScheduler] \u5347\u7EA7\u4EFB\u52A1${taskId}\u6267\u884C\u5931\u8D25: ${err.message}`);
            });
            break;
          }
        }
      }
      /**
       * 看门狗 - 确保调度器自身不会静默死亡
       */
      startWatchdog() {
        const WATCHDOG_INTERVAL = 5 * 60 * 1e3;
        this.watchdogTimer = setInterval(() => {
          this.lastWatchdogCheck = /* @__PURE__ */ new Date();
          for (const [taskId, task] of this.tasks.entries()) {
            if (!task.enabled) continue;
            const status = this.taskStatuses.get(taskId);
            if (!status) continue;
            if (status.lastRun) {
              const timeSinceLastRun = Date.now() - status.lastRun.getTime();
              const expectedMaxInterval = task.intervalMs * 3;
              if (timeSinceLastRun > expectedMaxInterval) {
                log137.warn(`[Watchdog] \u4EFB\u52A1${taskId}\u53EF\u80FD\u5DF2\u505C\u6B62! \u4E0A\u6B21\u8FD0\u884C: ${status.lastRun.toISOString()}, \u5DF2\u8FC7${Math.round(timeSinceLastRun / 1e3)}\u79D2`);
                if (this.running) {
                  log137.info(`[Watchdog] \u5C1D\u8BD5\u91CD\u65B0\u8C03\u5EA6\u4EFB\u52A1: ${taskId}`);
                  const existingTimer = this.timers.get(taskId);
                  if (existingTimer) clearTimeout(existingTimer);
                  this.scheduleTask(taskId);
                }
              }
            }
          }
          const activeTimers2 = this.timers.size;
          const enabledTasks = Array.from(this.tasks.values()).filter((t2) => t2.enabled).length;
          if (activeTimers2 < enabledTasks && this.running) {
            log137.warn(`[Watchdog] \u6D3B\u8DC3\u5B9A\u65F6\u5668(${activeTimers2})\u5C11\u4E8E\u542F\u7528\u4EFB\u52A1(${enabledTasks})\uFF0C\u53EF\u80FD\u6709\u4EFB\u52A1\u4E22\u5931`);
          }
          log137.debug(`[Watchdog] \u68C0\u67E5\u5B8C\u6210: \u8FD0\u884C\u4E2D=${this.running}, \u6D3B\u8DC3\u5B9A\u65F6\u5668=${activeTimers2}, \u542F\u7528\u4EFB\u52A1=${enabledTasks}`);
        }, WATCHDOG_INTERVAL);
      }
      /**
       * 计算错开的初始延迟，避免所有任务同时启动
       */
      getStaggeredDelay(taskId) {
        const taskIds = Array.from(this.tasks.keys());
        const index2 = taskIds.indexOf(taskId);
        return (index2 + 1) * 1e4;
      }
    };
    __name(createDefaultSelfHealingScheduler, "createDefaultSelfHealingScheduler");
    globalScheduler = null;
    __name(getSelfHealingScheduler, "getSelfHealingScheduler");
    __name(startSelfHealing, "startSelfHealing");
    __name(stopSelfHealing, "stopSelfHealing");
  }
});

