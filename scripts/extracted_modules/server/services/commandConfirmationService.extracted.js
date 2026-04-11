// Extracted from production dist/index.js
// Original module: server/services/commandConfirmationService.ts
// Lines: 376

var commandConfirmationService_exports = {};
__export(commandConfirmationService_exports, {
  CommandConfirmationService: () => CommandConfirmationService,
  getCommandConfirmationService: () => getCommandConfirmationService,
  submitReliableConfirmation: () => submitReliableConfirmation
});
function getCommandConfirmationService() {
  if (!globalService) {
    globalService = new CommandConfirmationService();
    globalService.start();
  }
  return globalService;
}
function submitReliableConfirmation(accountId, affectedEntities, triggerSource, operationType = "general") {
  return getCommandConfirmationService().submitConfirmation(
    accountId,
    affectedEntities,
    triggerSource,
    operationType
  );
}
var log91, PROPAGATION_CONFIGS, MAX_QUEUE_SIZE, REQUEST_EXPIRY_MS, PROCESSING_INTERVAL_MS, IDLE_INTERVAL_MS, CommandConfirmationService, globalService;
var init_commandConfirmationService = __esm({
  "server/services/commandConfirmationService.ts"() {
    "use strict";
    init_logger();
    init_opsLogger();
    log91 = createModuleLogger("CommandConfirmation");
    PROPAGATION_CONFIGS = {
      bid_change: {
        initialDelayMs: 5e3,
        // 出价变更通常5秒内传播
        retryIncrementMs: 5e3,
        maxDelayMs: 3e4
      },
      status_change: {
        initialDelayMs: 8e3,
        // 状态变更需要更长时间
        retryIncrementMs: 8e3,
        maxDelayMs: 6e4
      },
      budget_change: {
        initialDelayMs: 1e4,
        // 预算变更传播较慢
        retryIncrementMs: 1e4,
        maxDelayMs: 6e4
      },
      keyword_create: {
        initialDelayMs: 15e3,
        // 新建关键词需要最长传播时间
        retryIncrementMs: 15e3,
        maxDelayMs: 12e4
      },
      general: {
        initialDelayMs: 5e3,
        retryIncrementMs: 5e3,
        maxDelayMs: 3e4
      }
    };
    MAX_QUEUE_SIZE = 200;
    REQUEST_EXPIRY_MS = 30 * 60 * 1e3;
    PROCESSING_INTERVAL_MS = 2e3;
    IDLE_INTERVAL_MS = 1e4;
    CommandConfirmationService = class {
      static {
        __name(this, "CommandConfirmationService");
      }
      queue = /* @__PURE__ */ new Map();
      processingTimer = null;
      running = false;
      /** 历史传播延迟（用于自适应调整） */
      propagationHistory = /* @__PURE__ */ new Map();
      /** 指标 */
      metrics = {
        totalRequests: 0,
        pendingRequests: 0,
        confirmedRequests: 0,
        failedRequests: 0,
        expiredRequests: 0,
        avgConfirmationTimeMs: 0,
        avgRetryCount: 0,
        confirmationSuccessRate: 0,
        avgPropagationDelayByType: {}
      };
      totalConfirmationTimeMs = 0;
      totalRetryCount = 0;
      constructor() {
        log91.info("[CommandConfirmation] v359: \u521D\u59CB\u5316\u53EF\u9760\u6307\u4EE4\u786E\u8BA4\u670D\u52A1");
      }
      /**
       * 提交确认请求
       * 替代原来的fire-and-forget模式
       */
      submitConfirmation(accountId, affectedEntities, triggerSource, operationType = "general") {
        if (this.queue.size >= MAX_QUEUE_SIZE) {
          this.cleanupExpired();
          if (this.queue.size >= MAX_QUEUE_SIZE) {
            log91.warn(`[CommandConfirmation] \u961F\u5217\u5DF2\u6EE1(${MAX_QUEUE_SIZE})\uFF0C\u4E22\u5F03\u6700\u65E7\u7684\u8BF7\u6C42`);
            const oldest = Array.from(this.queue.values()).filter((r) => r.status === "pending").sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
            if (oldest) this.queue.delete(oldest.id);
          }
        }
        const config2 = PROPAGATION_CONFIGS[operationType] || PROPAGATION_CONFIGS.general;
        const adaptiveDelay = this.getAdaptiveDelay(operationType, config2);
        const request = {
          id: `confirm-${accountId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          accountId,
          affectedEntities,
          triggerSource,
          operationType,
          createdAt: /* @__PURE__ */ new Date(),
          expectedReadyAt: new Date(Date.now() + adaptiveDelay),
          retryCount: 0,
          maxRetries: 3,
          status: "waiting"
        };
        this.queue.set(request.id, request);
        this.metrics.totalRequests++;
        this.metrics.pendingRequests = this.queue.size;
        log91.info(`[CommandConfirmation] v359: \u63D0\u4EA4\u786E\u8BA4\u8BF7\u6C42 ${request.id}: \u8D26\u6237${accountId}, \u7C7B\u578B=${operationType}, \u5EF6\u8FDF=${adaptiveDelay}ms, \u6765\u6E90=${triggerSource}`);
        logSync("CommandConfirmation", "v359: \u63D0\u4EA4\u786E\u8BA4\u8BF7\u6C42", {
          requestId: request.id,
          accountId,
          operationType,
          adaptiveDelay,
          triggerSource
        });
        return request.id;
      }
      /**
       * 查询确认请求状态
       */
      getRequestStatus(requestId) {
        return this.queue.get(requestId) || null;
      }
      /**
       * 启动确认处理循环
       */
      start() {
        if (this.running) return;
        this.running = true;
        this.scheduleNextProcessing();
        log91.info("[CommandConfirmation] v360: \u786E\u8BA4\u5904\u7406\u5FAA\u73AF\u5DF2\u542F\u52A8\uFF08\u667A\u80FD\u8F6E\u8BE2\u6A21\u5F0F\uFF09");
      }
      /**
       * 停止确认处理循环
       */
      stop() {
        this.running = false;
        if (this.processingTimer) {
          clearTimeout(this.processingTimer);
          this.processingTimer = null;
        }
        log91.info("[CommandConfirmation] v360: \u786E\u8BA4\u5904\u7406\u5FAA\u73AF\u5DF2\u505C\u6B62");
      }
      /**
       * v360: 智能调度下一次处理
       * 队列有待处理项时使用2秒间隔，空闲时使用10秒间隔
       */
      scheduleNextProcessing() {
        if (!this.running) return;
        const hasPending = Array.from(this.queue.values()).some(
          (r) => r.status === "waiting" || r.status === "confirming"
        );
        const interval = hasPending ? PROCESSING_INTERVAL_MS : IDLE_INTERVAL_MS;
        this.processingTimer = setTimeout(() => {
          this.processQueue().catch((err) => {
            log91.warn(`[CommandConfirmation] \u5904\u7406\u5FAA\u73AF\u5F02\u5E38: ${err.message}`);
          }).finally(() => {
            this.scheduleNextProcessing();
          });
        }, interval);
      }
      /**
       * 获取确认服务指标
       */
      getMetrics() {
        const completed = this.metrics.confirmedRequests + this.metrics.failedRequests;
        return {
          ...this.metrics,
          pendingRequests: this.queue.size,
          avgConfirmationTimeMs: completed > 0 ? Math.round(this.totalConfirmationTimeMs / completed) : 0,
          avgRetryCount: completed > 0 ? Math.round(this.totalRetryCount / completed * 100) / 100 : 0,
          confirmationSuccessRate: completed > 0 ? Math.round(this.metrics.confirmedRequests / completed * 100) / 100 : 0,
          avgPropagationDelayByType: this.getAvgPropagationDelays()
        };
      }
      // ==================== 内部方法 ====================
      /**
       * 处理确认队列
       */
      async processQueue() {
        const now = Date.now();
        for (const [requestId, request] of this.queue.entries()) {
          if (request.status === "confirmed" || request.status === "failed" || request.status === "expired") {
            if (now - request.createdAt.getTime() > REQUEST_EXPIRY_MS) {
              this.queue.delete(requestId);
            }
            continue;
          }
          if (now - request.createdAt.getTime() > REQUEST_EXPIRY_MS) {
            request.status = "expired";
            this.metrics.expiredRequests++;
            log91.warn(`[CommandConfirmation] \u8BF7\u6C42${requestId}\u5DF2\u8FC7\u671F`);
            continue;
          }
          if (request.status === "waiting" && now >= request.expectedReadyAt.getTime()) {
            request.status = "confirming";
            await this.executeConfirmation(request);
          }
        }
      }
      /**
       * 执行确认同步
       */
      async executeConfirmation(request) {
        const startTime = Date.now();
        try {
          log91.info(`[CommandConfirmation] \u6267\u884C\u786E\u8BA4: ${request.id}, \u91CD\u8BD5=${request.retryCount}/${request.maxRetries}`);
          const { confirmationSync: confirmationSync2 } = await Promise.resolve().then(() => (init_unifiedSyncEngine(), unifiedSyncEngine_exports));
          const syncResult = await confirmationSync2(
            request.accountId,
            request.affectedEntities,
            `v359_reliable_${request.triggerSource}`
          );
          const durationMs = Date.now() - startTime;
          if (syncResult && syncResult.completedSteps > 0) {
            const matchRate = syncResult.totalSteps > 0 ? syncResult.completedSteps / syncResult.totalSteps : 0;
            request.status = "confirmed";
            request.lastResult = {
              // @ts-ignore
              success: true,
              // @ts-ignore
              completedSteps: syncResult.completedSteps,
              // @ts-ignore
              totalSteps: syncResult.totalSteps,
              // @ts-ignore
              totalSynced: syncResult.totalSynced,
              durationMs,
              matchRate,
              timestamp: /* @__PURE__ */ new Date()
            };
            this.metrics.confirmedRequests++;
            this.totalConfirmationTimeMs += Date.now() - request.createdAt.getTime();
            this.totalRetryCount += request.retryCount;
            const propagationDelay = request.expectedReadyAt.getTime() - request.createdAt.getTime();
            this.recordPropagationDelay(request.operationType, propagationDelay);
            log91.info(`[CommandConfirmation] \u786E\u8BA4\u6210\u529F: ${request.id}, \u6B65\u9AA4=${syncResult.completedSteps}/${syncResult.totalSteps}, \u5339\u914D\u7387=${(matchRate * 100).toFixed(1)}%, \u8017\u65F6=${durationMs}ms`);
          } else if (syncResult && syncResult.errors?.some((e) => e.includes("full\u5C42\u540C\u6B65\u5728\u8FD0\u884C") || e.includes("\u540C\u6B65\u5728\u8FD0\u884C"))) {
            request.status = "confirmed";
            request.lastResult = {
              success: true,
              completedSteps: 0,
              // @ts-ignore
              totalSteps: syncResult.totalSteps || 0,
              totalSynced: 0,
              // @ts-ignore
              durationMs,
              matchRate: 1,
              // full同步覆盖所有步骤，视为100%匹配
              timestamp: /* @__PURE__ */ new Date()
            };
            this.metrics.confirmedRequests++;
            this.totalConfirmationTimeMs += Date.now() - request.createdAt.getTime();
            this.totalRetryCount += request.retryCount;
            log91.info(`[CommandConfirmation] v388: \u786E\u8BA4\u5DF2\u88ABfull\u540C\u6B65\u8986\u76D6: ${request.id}, \u8017\u65F6=${durationMs}ms, \u539F\u56E0: ${syncResult.errors?.join(", ")}`);
          } else {
            await this.handleConfirmationFailure(request, durationMs, "\u786E\u8BA4\u540C\u6B65\u8FD4\u56DE\u7A7A\u7ED3\u679C\u62160\u6B65\u9AA4");
          }
        } catch (error48) {
          const durationMs = Date.now() - startTime;
          await this.handleConfirmationFailure(request, durationMs, error48.message);
        }
      }
      /**
       * 处理确认失败
       */
      async handleConfirmationFailure(request, durationMs, errorMsg) {
        request.retryCount++;
        if (request.retryCount >= request.maxRetries) {
          request.status = "failed";
          request.lastResult = {
            success: false,
            completedSteps: 0,
            totalSteps: 0,
            totalSynced: 0,
            durationMs,
            matchRate: 0,
            timestamp: /* @__PURE__ */ new Date()
          };
          this.metrics.failedRequests++;
          this.totalConfirmationTimeMs += Date.now() - request.createdAt.getTime();
          this.totalRetryCount += request.retryCount;
          log91.warn(`[CommandConfirmation] \u786E\u8BA4\u6700\u7EC8\u5931\u8D25: ${request.id}, \u91CD\u8BD5${request.retryCount}\u6B21\u540E\u653E\u5F03: ${errorMsg}`);
          logSyncError("CommandConfirmation", `v359: \u786E\u8BA4\u6700\u7EC8\u5931\u8D25`, {
            requestId: request.id,
            accountId: request.accountId,
            operationType: request.operationType,
            retryCount: request.retryCount,
            error: errorMsg
          });
        } else {
          const config2 = PROPAGATION_CONFIGS[request.operationType] || PROPAGATION_CONFIGS.general;
          const additionalDelay = config2.retryIncrementMs * request.retryCount;
          request.expectedReadyAt = new Date(Date.now() + additionalDelay);
          request.status = "waiting";
          log91.warn(`[CommandConfirmation] \u786E\u8BA4\u91CD\u8BD5: ${request.id}, \u7B2C${request.retryCount}\u6B21, \u989D\u5916\u7B49\u5F85${additionalDelay}ms: ${errorMsg}`);
        }
      }
      /**
       * 获取自适应传播延迟
       * 基于历史数据动态调整
       */
      getAdaptiveDelay(operationType, config2) {
        const history = this.propagationHistory.get(operationType);
        if (!history || history.length < 5) {
          return config2.initialDelayMs;
        }
        const recent = history.slice(-20).sort((a, b) => a - b);
        const p75Index = Math.floor(recent.length * 0.75);
        const p75Delay = recent[p75Index];
        const adaptiveDelay = Math.round(p75Delay * 1.2);
        return Math.max(config2.initialDelayMs, Math.min(adaptiveDelay, config2.maxDelayMs));
      }
      /**
       * 记录传播延迟
       */
      recordPropagationDelay(operationType, delayMs) {
        if (!this.propagationHistory.has(operationType)) {
          this.propagationHistory.set(operationType, []);
        }
        const history = this.propagationHistory.get(operationType);
        history.push(delayMs);
        if (history.length > 100) {
          this.propagationHistory.set(operationType, history.slice(-50));
        }
      }
      /**
       * 获取按类型的平均传播延迟
       */
      getAvgPropagationDelays() {
        const result = {};
        for (const [type, history] of this.propagationHistory.entries()) {
          if (history.length > 0) {
            result[type] = Math.round(history.reduce((a, b) => a + b, 0) / history.length);
          }
        }
        return result;
      }
      /**
       * 清理过期请求
       */
      cleanupExpired() {
        const now = Date.now();
        let cleaned = 0;
        for (const [requestId, request] of this.queue.entries()) {
          if (now - request.createdAt.getTime() > REQUEST_EXPIRY_MS) {
            if (request.status === "pending" || request.status === "waiting") {
              request.status = "expired";
              this.metrics.expiredRequests++;
            }
            this.queue.delete(requestId);
            cleaned++;
          }
        }
        if (cleaned > 0) {
          log91.info(`[CommandConfirmation] \u6E05\u7406${cleaned}\u4E2A\u8FC7\u671F\u8BF7\u6C42`);
        }
      }
    };
    globalService = null;
    __name(getCommandConfirmationService, "getCommandConfirmationService");
    __name(submitReliableConfirmation, "submitReliableConfirmation");
  }
});

