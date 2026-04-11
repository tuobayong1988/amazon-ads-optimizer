// Extracted from production dist/index.js
// Original module: server/sync/scheduling/tieredSyncService.ts
// Lines: 383

var log174, TIER_CONFIG, TieredSyncService, tieredSyncService;
var init_tieredSyncService = __esm({
  "server/sync/scheduling/tieredSyncService.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_logger();
    log174 = createModuleLogger("TieredSync");
    TIER_CONFIG = {
      realtime: {
        name: "\u5B9E\u65F6\u5C42",
        startDay: 0,
        endDay: 7,
        sliceSize: 1,
        reportTypes: ["campaign", "adGroup", "keyword", "target"],
        priority: "critical",
        description: "\u6700\u8FD17\u5929\u6570\u636E\uFF0C\u7B97\u6CD5\u51B3\u7B56\u6700\u9700\u8981\uFF0C\u6700\u9AD8\u7C92\u5EA6"
      },
      hot: {
        name: "\u70ED\u6570\u636E\u5C42",
        startDay: 8,
        endDay: 30,
        sliceSize: 7,
        reportTypes: ["campaign", "adGroup", "keyword", "target"],
        priority: "high",
        description: "8-30\u5929\u6570\u636E\uFF0C\u5F52\u56E0\u56DE\u6EAF\u671F\uFF0C\u9700\u8981\u5B8C\u6574\u6570\u636E"
      },
      warm: {
        name: "\u6E29\u6570\u636E\u5C42",
        startDay: 31,
        endDay: 90,
        sliceSize: 15,
        reportTypes: ["campaign", "adGroup"],
        priority: "medium",
        description: "31-90\u5929\u6570\u636E\uFF0C\u8D8B\u52BF\u5206\u6790\u7528\uFF0C\u4E2D\u7B49\u7C92\u5EA6"
      },
      cold: {
        name: "\u51B7\u6570\u636E\u5C42",
        startDay: 91,
        endDay: 365,
        sliceSize: 30,
        reportTypes: ["campaign"],
        priority: "low",
        description: "91-365\u5929\u6570\u636E\uFF0C\u5386\u53F2\u57FA\u7EBF\uFF0C\u53EA\u9700Campaign\u6C47\u603B"
      }
    };
    TieredSyncService = class {
      static {
        __name(this, "TieredSyncService");
      }
      /**
       * 获取分层配置
       */
      getTierConfig() {
        return TIER_CONFIG;
      }
      /**
       * 计算各层任务数量
       */
      calculateTaskCounts() {
        const result = [];
        for (const [tier2, config2] of Object.entries(TIER_CONFIG)) {
          const days = config2.endDay - config2.startDay;
          const slices = Math.ceil(days / config2.sliceSize);
          const reportTypes = config2.reportTypes.length;
          const totalTasks = slices * reportTypes;
          result.push({
            tier: tier2,
            name: config2.name,
            slices,
            reportTypes,
            totalTasks,
            description: config2.description
          });
        }
        return result;
      }
      /**
       * 获取总任务数
       */
      getTotalTaskCount() {
        return this.calculateTaskCounts().reduce((sum2, t2) => sum2 + t2.totalTasks, 0);
      }
      /**
       * 生成日期切片
       */
      generateDateSlices(startDay, endDay, sliceSize) {
        const slices = [];
        const today = /* @__PURE__ */ new Date();
        let currentDay = startDay;
        while (currentDay < endDay) {
          const sliceEndDay = Math.min(currentDay + sliceSize, endDay);
          const startDate = new Date(today);
          startDate.setDate(startDate.getDate() - sliceEndDay);
          const endDate = new Date(today);
          endDate.setDate(endDate.getDate() - currentDay - 1);
          slices.push({
            startDate: startDate.toISOString().split("T")[0],
            endDate: endDate.toISOString().split("T")[0]
          });
          currentDay = sliceEndDay;
        }
        return slices;
      }
      /**
       * 创建分层初始化任务
       */
      async createTieredInitializationTasks(accountId, profileId) {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const taskIds = [];
        const tasksByTier = {
          realtime: 0,
          hot: 0,
          warm: 0,
          cold: 0
        };
        const tierOrder = ["realtime", "hot", "warm", "cold"];
        for (const tier2 of tierOrder) {
          const config2 = TIER_CONFIG[tier2];
          const slices = this.generateDateSlices(config2.startDay, config2.endDay, config2.sliceSize);
          for (const slice of slices) {
            for (const reportType of config2.reportTypes) {
              for (const adType of ["SP", "SB", "SD"]) {
                const [result] = await db.insert(reportJobs).values({
                  accountId,
                  profileId,
                  reportType: `tiered_${tier2}_${reportType}`,
                  adProduct: adType,
                  startDate: slice.startDate,
                  endDate: slice.endDate,
                  status: "pending",
                  priority: config2.priority,
                  retryCount: 0,
                  requestPayload: JSON.stringify({ adType }),
                  metadata: JSON.stringify({
                    tier: tier2,
                    reportType,
                    adType,
                    tierConfig: config2,
                    processedRanges: [],
                    failedRanges: []
                  }),
                  createdAt: (/* @__PURE__ */ new Date()).toISOString()
                });
                taskIds.push(result.insertId);
                tasksByTier[tier2]++;
              }
            }
          }
        }
        log174.info(`[TieredSyncService] Created ${taskIds.length} tiered initialization tasks for account ${accountId}`);
        log174.info(`[TieredSyncService] Tasks by tier:`, tasksByTier);
        return {
          totalTasks: taskIds.length,
          tasksByTier,
          taskIds
        };
      }
      /**
       * 获取任务进度
       */
      async getTaskProgress(taskId) {
        const db = await getDb();
        if (!db) return null;
        const [task] = await db.select().from(reportJobs).where(eq(reportJobs.id, taskId)).limit(1);
        if (!task) return null;
        const metadata = task.metadata ? JSON.parse(task.metadata) : {};
        return {
          taskId: task.id,
          tier: metadata.tier || "unknown",
          reportType: metadata.reportType || "unknown",
          startDate: task.startDate || "",
          endDate: task.endDate || "",
          processedRanges: metadata.processedRanges || [],
          failedRanges: metadata.failedRanges || [],
          status: task.status,
          lastCheckpoint: metadata.lastCheckpoint || null
        };
      }
      /**
       * 更新任务进度（断点续传支持）
       */
      async updateTaskProgress(taskId, update) {
        const db = await getDb();
        if (!db) return;
        const progress = await this.getTaskProgress(taskId);
        if (!progress) return;
        const metadata = {
          tier: progress.tier,
          reportType: progress.reportType,
          processedRanges: progress.processedRanges,
          failedRanges: progress.failedRanges,
          lastCheckpoint: progress.lastCheckpoint
        };
        if (update.processedRange) {
          metadata.processedRanges.push(update.processedRange);
        }
        if (update.failedRange) {
          const existingFailed = metadata.failedRanges.find(
            (r) => r.start === update.failedRange.start && r.end === update.failedRange.end
          );
          if (existingFailed) {
            existingFailed.retryCount = (existingFailed.retryCount || 0) + 1;
            existingFailed.error = update.failedRange.error;
          } else {
            metadata.failedRanges.push({
              ...update.failedRange,
              retryCount: 1
            });
          }
        }
        if (update.checkpoint) {
          metadata.lastCheckpoint = update.checkpoint;
        }
        const newStatus = update.status || progress.status;
        const validStatuses = ["pending", "submitted", "processing", "completed", "failed", "expired"];
        const finalStatus = validStatuses.includes(newStatus) ? newStatus : "pending";
        await db.update(reportJobs).set({
          status: finalStatus,
          metadata: JSON.stringify(metadata),
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        }).where(eq(reportJobs.id, taskId));
      }
      /**
       * 获取需要重试的失败范围
       */
      async getFailedRangesForRetry(taskId, maxRetries = 3) {
        const progress = await this.getTaskProgress(taskId);
        if (!progress) return [];
        return progress.failedRanges.filter((r) => r.retryCount < maxRetries).map((r) => ({ start: r.start, end: r.end }));
      }
      /**
       * 检查任务是否可以标记为完成
       */
      async checkTaskCompletion(taskId) {
        const progress = await this.getTaskProgress(taskId);
        if (!progress) {
          return { isComplete: false, hasFailures: false, completionPercent: 0 };
        }
        const totalDays = this.calculateDaysBetween(progress.startDate, progress.endDate);
        const processedDays = progress.processedRanges.reduce((sum2, r) => {
          return sum2 + this.calculateDaysBetween(r.start, r.end);
        }, 0);
        const failedDays = progress.failedRanges.reduce((sum2, r) => {
          return sum2 + this.calculateDaysBetween(r.start, r.end);
        }, 0);
        const completionPercent = totalDays > 0 ? Math.round(processedDays / totalDays * 100) : 0;
        const hasFailures = progress.failedRanges.length > 0;
        const isComplete = processedDays + failedDays >= totalDays;
        return { isComplete, hasFailures, completionPercent };
      }
      /**
       * 计算两个日期之间的天数
       */
      calculateDaysBetween(start, end) {
        const startDate = new Date(start);
        const endDate = new Date(end);
        const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
        return Math.ceil(diffTime / (1e3 * 60 * 60 * 24)) + 1;
      }
      /**
       * 获取初始化进度统计
       */
      async getInitializationStats(accountId) {
        const db = await getDb();
        if (!db) {
          return {
            totalTasks: 0,
            completedTasks: 0,
            failedTasks: 0,
            pendingTasks: 0,
            processingTasks: 0,
            progressByTier: {
              realtime: { total: 0, completed: 0, failed: 0, pending: 0, processing: 0, percent: 0 },
              hot: { total: 0, completed: 0, failed: 0, pending: 0, processing: 0, percent: 0 },
              warm: { total: 0, completed: 0, failed: 0, pending: 0, processing: 0, percent: 0 },
              cold: { total: 0, completed: 0, failed: 0, pending: 0, processing: 0, percent: 0 }
            },
            overallPercent: 0
          };
        }
        const tasks = await db.select().from(reportJobs).where(
          and(
            eq(reportJobs.accountId, accountId),
            sql`${reportJobs.reportType} LIKE 'tiered_%'`
          )
        );
        const progressByTier = {
          realtime: { total: 0, completed: 0, failed: 0, pending: 0, processing: 0, percent: 0 },
          hot: { total: 0, completed: 0, failed: 0, pending: 0, processing: 0, percent: 0 },
          warm: { total: 0, completed: 0, failed: 0, pending: 0, processing: 0, percent: 0 },
          cold: { total: 0, completed: 0, failed: 0, pending: 0, processing: 0, percent: 0 }
        };
        let totalTasks = 0;
        let completedTasks = 0;
        let failedTasks = 0;
        let pendingTasks2 = 0;
        let processingTasks = 0;
        for (const task of tasks) {
          const metadata = task.metadata ? JSON.parse(task.metadata) : {};
          const tier2 = metadata.tier;
          if (!tier2 || !progressByTier[tier2]) continue;
          totalTasks++;
          progressByTier[tier2].total++;
          switch (task.status) {
            case "completed":
              completedTasks++;
              progressByTier[tier2].completed++;
              break;
            case "failed":
              failedTasks++;
              progressByTier[tier2].failed++;
              break;
            case "pending":
              pendingTasks2++;
              progressByTier[tier2].pending++;
              break;
            case "submitted":
            case "processing":
              processingTasks++;
              progressByTier[tier2].processing++;
              break;
          }
        }
        for (const tier2 of Object.keys(progressByTier)) {
          const tierStats = progressByTier[tier2];
          tierStats.percent = tierStats.total > 0 ? Math.round(tierStats.completed / tierStats.total * 100) : 0;
        }
        const overallPercent = totalTasks > 0 ? Math.round(completedTasks / totalTasks * 100) : 0;
        return {
          totalTasks,
          completedTasks,
          failedTasks,
          pendingTasks: pendingTasks2,
          processingTasks,
          progressByTier,
          overallPercent
        };
      }
      /**
       * 重试失败的任务（增量重试）
       */
      async retryFailedTasks(accountId, maxRetries = 3) {
        const db = await getDb();
        if (!db) return { retriedCount: 0, skippedCount: 0 };
        const failedTasks = await db.select().from(reportJobs).where(
          and(
            eq(reportJobs.accountId, accountId),
            eq(reportJobs.status, "failed"),
            sql`${reportJobs.reportType} LIKE 'tiered_%'`
          )
        );
        let retriedCount = 0;
        let skippedCount = 0;
        for (const task of failedTasks) {
          const metadata = task.metadata ? JSON.parse(task.metadata) : {};
          const failedRanges = metadata.failedRanges || [];
          const retryableRanges = failedRanges.filter((r) => r.retryCount < maxRetries);
          if (retryableRanges.length > 0) {
            await db.update(reportJobs).set({
              status: "pending",
              metadata: JSON.stringify({
                ...metadata,
                retryMode: true,
                rangesToProcess: retryableRanges.map((r) => ({ start: r.start, end: r.end }))
              }),
              updatedAt: (/* @__PURE__ */ new Date()).toISOString()
            }).where(eq(reportJobs.id, task.id));
            retriedCount++;
          } else {
            skippedCount++;
          }
        }
        log174.info(`[TieredSyncService] Retried ${retriedCount} tasks, skipped ${skippedCount} (max retries exceeded)`);
        return { retriedCount, skippedCount };
      }
    };
    tieredSyncService = new TieredSyncService();
  }
});

