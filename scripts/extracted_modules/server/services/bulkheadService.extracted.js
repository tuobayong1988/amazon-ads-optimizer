// Extracted from production dist/index.js
// Original module: server/services/bulkheadService.ts
// Lines: 392

function getBulkhead() {
  if (!globalBulkhead) {
    globalBulkhead = new BulkheadService();
  }
  return globalBulkhead;
}
var log72, TIER_CONFIGS, CATEGORY_CONFIGS, HEALTH_THRESHOLDS, BulkheadService, globalBulkhead;
var init_bulkheadService = __esm({
  "server/services/bulkheadService.ts"() {
    "use strict";
    init_logger();
    init_systemVersion();
    log72 = createModuleLogger("Bulkhead");
    TIER_CONFIGS = {
      vip: {
        maxConcurrency: 5,
        maxQueueSize: 20,
        queueTimeoutMs: 6e4
      },
      standard: {
        maxConcurrency: 3,
        maxQueueSize: 15,
        queueTimeoutMs: 45e3
      },
      trial: {
        maxConcurrency: 1,
        maxQueueSize: 5,
        queueTimeoutMs: 3e4
      }
    };
    CATEGORY_CONFIGS = {
      sync: {
        maxConcurrency: 4,
        maxQueueSize: 30,
        queueTimeoutMs: 12e4
      },
      optimization: {
        maxConcurrency: 3,
        maxQueueSize: 50,
        queueTimeoutMs: 6e4
      },
      report: {
        maxConcurrency: 2,
        maxQueueSize: 10,
        queueTimeoutMs: 3e5
      },
      alignment: {
        maxConcurrency: 1,
        maxQueueSize: 5,
        queueTimeoutMs: 6e4
      }
    };
    HEALTH_THRESHOLDS = {
      /** 连续失败次数达到此值时降级 */
      degradeAfterFailures: 5,
      /** 连续失败次数达到此值时隔离 */
      quarantineAfterFailures: 15,
      /** 连续成功次数达到此值时恢复 */
      recoverAfterSuccesses: 10,
      /** 隔离最短持续时间（毫秒） */
      minQuarantineDurationMs: 10 * 60 * 1e3,
      // 10 分钟
      /** 降级时并发度缩减系数 */
      degradedConcurrencyFactor: 0.5,
      /** 隔离时并发度缩减系数 */
      quarantinedConcurrencyFactor: 0.2
    };
    BulkheadService = class {
      static {
        __name(this, "BulkheadService");
      }
      /** 按 "层级:类别" 组合键的舱壁池 */
      bulkheads = /* @__PURE__ */ new Map();
      /** 账户健康状态跟踪 */
      accountHealth = /* @__PURE__ */ new Map();
      /** 账户层级映射（由外部注入） */
      accountTiers = /* @__PURE__ */ new Map();
      constructor() {
        log72.info(`[v${SYSTEM_VERSION}] Bulkhead \u521D\u59CB\u5316\u5B8C\u6210 | \u5C42\u7EA7\u914D\u7F6E: VIP=${TIER_CONFIGS.vip.maxConcurrency}, Standard=${TIER_CONFIGS.standard.maxConcurrency}, Trial=${TIER_CONFIGS.trial.maxConcurrency}`);
        setInterval(() => this.cleanupTimedOutQueue(), 1e4);
      }
      // ==================== 账户层级管理 ====================
      /**
       * 注册账户层级
       */
      setAccountTier(accountId, tier2) {
        this.accountTiers.set(accountId, tier2);
      }
      /**
       * 批量注册账户层级
       */
      setAccountTiers(tiers) {
        for (const [accountId, tier2] of tiers) {
          this.accountTiers.set(accountId, tier2);
        }
      }
      /**
       * 获取账户的有效层级（考虑健康状态降级）
       */
      getEffectiveTier(accountId) {
        const baseTier = this.accountTiers.get(accountId) || "standard";
        const healthState = this.accountHealth.get(accountId);
        if (!healthState) return baseTier;
        if (healthState.health === "quarantined") {
          return "trial";
        }
        if (healthState.health === "degraded") {
          if (baseTier === "vip") return "standard";
          return "trial";
        }
        return baseTier;
      }
      // ==================== 资源获取与释放 ====================
      /**
       * 获取舱壁键
       */
      getBulkheadKey(tier2, category) {
        return `${tier2}:${category}`;
      }
      /**
       * 获取或创建舱壁实例
       */
      getOrCreateBulkhead(tier2, category) {
        const key = this.getBulkheadKey(tier2, category);
        let bulkhead = this.bulkheads.get(key);
        if (!bulkhead) {
          const tierConfig = TIER_CONFIGS[tier2];
          const categoryConfig = CATEGORY_CONFIGS[category];
          const config2 = {
            maxConcurrency: Math.min(tierConfig.maxConcurrency, categoryConfig.maxConcurrency),
            maxQueueSize: Math.min(tierConfig.maxQueueSize, categoryConfig.maxQueueSize),
            queueTimeoutMs: Math.min(tierConfig.queueTimeoutMs, categoryConfig.queueTimeoutMs)
          };
          bulkhead = {
            config: config2,
            activeTasks: 0,
            queue: [],
            totalProcessed: 0,
            totalRejected: 0,
            totalTimedOut: 0
          };
          this.bulkheads.set(key, bulkhead);
        }
        return bulkhead;
      }
      /**
       * 获取有效的最大并发度（考虑账户健康状态）
       */
      getEffectiveMaxConcurrency(accountId, bulkhead) {
        const healthState = this.accountHealth.get(accountId);
        if (!healthState) return bulkhead.config.maxConcurrency;
        let factor = 1;
        if (healthState.health === "degraded") {
          factor = HEALTH_THRESHOLDS.degradedConcurrencyFactor;
        } else if (healthState.health === "quarantined") {
          factor = HEALTH_THRESHOLDS.quarantinedConcurrencyFactor;
        }
        return Math.max(1, Math.floor(bulkhead.config.maxConcurrency * factor));
      }
      /**
       * 尝试获取资源槽位
       * 
       * @param accountId 账户 ID
       * @param category 任务类别
       * @param label 任务标签（用于日志）
       * @param wait 是否等待（排队）
       * @returns true = 获取成功, false = 被拒绝
       */
      async acquire(accountId, category, label = "", wait = true) {
        const effectiveTier = this.getEffectiveTier(accountId);
        const bulkhead = this.getOrCreateBulkhead(effectiveTier, category);
        const effectiveMax = this.getEffectiveMaxConcurrency(accountId, bulkhead);
        if (bulkhead.activeTasks < effectiveMax) {
          bulkhead.activeTasks++;
          bulkhead.totalProcessed++;
          return true;
        }
        if (!wait) {
          bulkhead.totalRejected++;
          log72.debug(`[v${SYSTEM_VERSION}] Bulkhead [${effectiveTier}:${category}] \u62D2\u7EDD ${label} | \u6D3B\u8DC3=${bulkhead.activeTasks}/${effectiveMax}`);
          return false;
        }
        if (bulkhead.queue.length >= bulkhead.config.maxQueueSize) {
          bulkhead.totalRejected++;
          log72.warn(`[v${SYSTEM_VERSION}] Bulkhead [${effectiveTier}:${category}] \u961F\u5217\u5DF2\u6EE1, \u62D2\u7EDD ${label} | \u961F\u5217=${bulkhead.queue.length}/${bulkhead.config.maxQueueSize}`);
          return false;
        }
        return new Promise((resolve) => {
          bulkhead.queue.push({
            resolve,
            enqueueTime: Date.now(),
            label
          });
        });
      }
      /**
       * 释放资源槽位
       */
      release(accountId, category) {
        const effectiveTier = this.getEffectiveTier(accountId);
        const key = this.getBulkheadKey(effectiveTier, category);
        const bulkhead = this.bulkheads.get(key);
        if (!bulkhead) return;
        bulkhead.activeTasks = Math.max(0, bulkhead.activeTasks - 1);
        this.drainQueue(bulkhead, accountId);
      }
      /**
       * 从队列中取出等待者
       */
      drainQueue(bulkhead, accountId) {
        const effectiveMax = this.getEffectiveMaxConcurrency(accountId, bulkhead);
        while (bulkhead.queue.length > 0 && bulkhead.activeTasks < effectiveMax) {
          const waiter = bulkhead.queue.shift();
          if (waiter) {
            bulkhead.activeTasks++;
            bulkhead.totalProcessed++;
            waiter.resolve(true);
          }
        }
      }
      /**
       * 清理超时的队列等待者
       */
      cleanupTimedOutQueue() {
        const now = Date.now();
        for (const [key, bulkhead] of this.bulkheads.entries()) {
          const timedOut = [];
          for (let i = bulkhead.queue.length - 1; i >= 0; i--) {
            const waiter = bulkhead.queue[i];
            if (now - waiter.enqueueTime > bulkhead.config.queueTimeoutMs) {
              timedOut.push(i);
            }
          }
          for (const idx of timedOut) {
            const waiter = bulkhead.queue.splice(idx, 1)[0];
            if (waiter) {
              bulkhead.totalTimedOut++;
              waiter.resolve(false);
              log72.warn(`[v${SYSTEM_VERSION}] Bulkhead [${key}] \u961F\u5217\u8D85\u65F6: ${waiter.label} (\u7B49\u5F85${Math.round((now - waiter.enqueueTime) / 1e3)}s)`);
            }
          }
        }
      }
      // ==================== 账户健康管理 ====================
      /**
       * 记录账户任务成功
       */
      recordAccountSuccess(accountId) {
        const state = this.getOrCreateHealthState(accountId);
        state.consecutiveSuccesses++;
        state.consecutiveFailures = 0;
        state.lastSuccessTime = Date.now();
        if (state.health !== "healthy" && state.consecutiveSuccesses >= HEALTH_THRESHOLDS.recoverAfterSuccesses) {
          if (state.health === "quarantined") {
            const elapsed = Date.now() - state.quarantinedAt;
            if (elapsed < HEALTH_THRESHOLDS.minQuarantineDurationMs) {
              return;
            }
          }
          const oldHealth = state.health;
          if (state.health === "quarantined") {
            state.health = "degraded";
            state.consecutiveSuccesses = 0;
            log72.info(`[v${SYSTEM_VERSION}] Bulkhead \u8D26\u6237${accountId} \u5065\u5EB7\u6062\u590D: ${oldHealth} \u2192 degraded`);
          } else {
            state.health = "healthy";
            state.reason = "";
            log72.info(`[v${SYSTEM_VERSION}] Bulkhead \u8D26\u6237${accountId} \u5065\u5EB7\u6062\u590D: ${oldHealth} \u2192 healthy`);
          }
        }
      }
      /**
       * 记录账户任务失败
       */
      recordAccountFailure(accountId, reason = "") {
        const state = this.getOrCreateHealthState(accountId);
        state.consecutiveFailures++;
        state.consecutiveSuccesses = 0;
        state.lastFailureTime = Date.now();
        if (state.health === "healthy" && state.consecutiveFailures >= HEALTH_THRESHOLDS.degradeAfterFailures) {
          state.health = "degraded";
          state.degradedAt = Date.now();
          state.reason = reason || `\u8FDE\u7EED\u5931\u8D25${state.consecutiveFailures}\u6B21`;
          log72.warn(`[v${SYSTEM_VERSION}] Bulkhead \u8D26\u6237${accountId} \u964D\u7EA7: healthy \u2192 degraded | ${state.reason}`);
        } else if (state.health === "degraded" && state.consecutiveFailures >= HEALTH_THRESHOLDS.quarantineAfterFailures) {
          state.health = "quarantined";
          state.quarantinedAt = Date.now();
          state.reason = reason || `\u8FDE\u7EED\u5931\u8D25${state.consecutiveFailures}\u6B21`;
          log72.warn(`[v${SYSTEM_VERSION}] Bulkhead \u8D26\u6237${accountId} \u9694\u79BB: degraded \u2192 quarantined | ${state.reason}`);
        }
      }
      /**
       * 获取账户健康状态
       */
      getAccountHealth(accountId) {
        const state = this.accountHealth.get(accountId);
        return {
          accountId,
          health: state?.health || "healthy",
          consecutiveFailures: state?.consecutiveFailures || 0,
          consecutiveSuccesses: state?.consecutiveSuccesses || 0,
          reason: state?.reason || "",
          effectiveTier: this.getEffectiveTier(accountId)
        };
      }
      /**
       * 手动恢复账户健康状态
       */
      resetAccountHealth(accountId) {
        this.accountHealth.delete(accountId);
        log72.info(`[v${SYSTEM_VERSION}] Bulkhead \u8D26\u6237${accountId} \u5065\u5EB7\u72B6\u6001\u5DF2\u624B\u52A8\u91CD\u7F6E`);
      }
      getOrCreateHealthState(accountId) {
        let state = this.accountHealth.get(accountId);
        if (!state) {
          state = {
            health: "healthy",
            consecutiveFailures: 0,
            consecutiveSuccesses: 0,
            lastFailureTime: 0,
            lastSuccessTime: 0,
            degradedAt: 0,
            quarantinedAt: 0,
            reason: ""
          };
          this.accountHealth.set(accountId, state);
        }
        return state;
      }
      // ==================== 查询接口 ====================
      /**
       * 获取所有舱壁状态
       */
      getAllStatus() {
        const statuses = [];
        for (const [key, bulkhead] of this.bulkheads.entries()) {
          statuses.push({
            key,
            maxConcurrency: bulkhead.config.maxConcurrency,
            activeTasks: bulkhead.activeTasks,
            queueLength: bulkhead.queue.length,
            maxQueueSize: bulkhead.config.maxQueueSize,
            totalProcessed: bulkhead.totalProcessed,
            totalRejected: bulkhead.totalRejected,
            totalTimedOut: bulkhead.totalTimedOut,
            utilization: bulkhead.config.maxConcurrency > 0 ? bulkhead.activeTasks / bulkhead.config.maxConcurrency : 0
          });
        }
        return statuses;
      }
      /**
       * 获取所有不健康的账户
       */
      getUnhealthyAccounts() {
        const unhealthy = [];
        for (const [accountId, state] of this.accountHealth.entries()) {
          if (state.health !== "healthy") {
            unhealthy.push(this.getAccountHealth(accountId));
          }
        }
        return unhealthy;
      }
      /**
       * 获取健康摘要
       */
      getHealthSummary() {
        let totalActiveTasks = 0, totalQueuedTasks = 0, totalRejected = 0;
        for (const bulkhead of this.bulkheads.values()) {
          totalActiveTasks += bulkhead.activeTasks;
          totalQueuedTasks += bulkhead.queue.length;
          totalRejected += bulkhead.totalRejected;
        }
        let unhealthyAccounts = 0, quarantinedAccounts = 0;
        for (const state of this.accountHealth.values()) {
          if (state.health !== "healthy") unhealthyAccounts++;
          if (state.health === "quarantined") quarantinedAccounts++;
        }
        return {
          totalBulkheads: this.bulkheads.size,
          totalActiveTasks,
          totalQueuedTasks,
          totalRejected,
          unhealthyAccounts,
          quarantinedAccounts
        };
      }
    };
    globalBulkhead = null;
    __name(getBulkhead, "getBulkhead");
  }
});

