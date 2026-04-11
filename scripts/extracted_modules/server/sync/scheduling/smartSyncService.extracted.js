// Extracted from production dist/index.js
// Original module: server/sync/scheduling/smartSyncService.ts
// Lines: 273

var log173, SYNC_CONFIG, SmartSyncService, smartSyncService;
var init_smartSyncService = __esm({
  "server/sync/scheduling/smartSyncService.ts"() {
    "use strict";
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_accountInitializationService2();
    init_asyncReportService();
    init_logger();
    log173 = createModuleLogger("SmartSync");
    SYNC_CONFIG = {
      // 增量同步配置
      incremental: {
        // 同步T-1天数据
        daysBack: 1,
        // 归因回溯配置
        attribution: {
          SP: 14,
          // SP广告14天归因窗口
          SB: 30,
          // SB广告30天归因窗口
          SD: 30
          // SD广告30天归因窗口
        },
        // 归因回溯频率（每N天执行一次完整回溯）
        fullAttributionFrequency: 7,
        // 日常只校验最近N天的归因数据
        dailyAttributionCheck: 3
      },
      // 初始化同步配置
      initialization: {
        hotData: {
          days: 90,
          sliceSize: 3
          // 3天一个切片
        },
        coldData: {
          startDay: 91,
          endDay: 365,
          sliceSize: 14
          // 14天一个切片
        },
        // 按广告类型拆分
        adTypes: ["SP", "SB", "SD"]
      }
    };
    SmartSyncService = class {
      static {
        __name(this, "SmartSyncService");
      }
      asyncReportService;
      constructor() {
        this.asyncReportService = new AsyncReportService();
      }
      /**
       * 获取账号的同步模式
       */
      async getSyncMode(accountId) {
        const isCompleted = await accountInitializationService.isInitializationCompleted(accountId);
        return isCompleted ? "incremental" : "initialization";
      }
      /**
       * 执行智能同步
       * 根据账号状态自动选择同步策略
       */
      async executeSmartSync(accountId) {
        const mode = await this.getSyncMode(accountId);
        if (mode === "initialization") {
          const result = await accountInitializationService.startInitialization(accountId);
          const totalTasks = result.phases?.reduce((sum2, p) => sum2 + p.totalTasks, 0) || 0;
          return {
            mode: "initialization",
            tasksCreated: totalTasks,
            message: result.message
          };
        } else {
          const tasksCreated = await this.executeIncrementalSync(accountId);
          return {
            mode: "incremental",
            tasksCreated,
            message: `\u589E\u91CF\u540C\u6B65\u4EFB\u52A1\u5DF2\u521B\u5EFA\uFF0C\u5171 ${tasksCreated} \u4E2A\u4EFB\u52A1`
          };
        }
      }
      /**
       * 执行增量同步
       * 只同步T-1天数据 + 定期归因回溯
       */
      async executeIncrementalSync(accountId) {
        const db = await getDb();
        if (!db) return 0;
        let tasksCreated = 0;
        const [account] = await db.select().from(adAccounts).where(eq(adAccounts.id, accountId)).limit(1);
        if (!account || !account.profileId) {
          log173.info(`[SmartSync] \u8D26\u53F7 ${accountId} \u65E0\u6548\u6216\u672A\u914D\u7F6EprofileId`);
          return 0;
        }
        const profileId = account.profileId;
        const yesterday = /* @__PURE__ */ new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split("T")[0];
        for (const adType of ["SP", "SB", "SD"]) {
          await this.asyncReportService.createReportJob({
            accountId,
            profileId,
            adType,
            startDate: yesterdayStr,
            endDate: yesterdayStr
          });
          tasksCreated++;
        }
        const needsFullAttribution = await this.checkNeedsFullAttribution(accountId);
        if (needsFullAttribution) {
          const attributionTasks = await this.asyncReportService.createAttributionJobs(accountId, profileId);
          tasksCreated += attributionTasks.length;
          log173.info(`[SmartSync] \u8D26\u53F7 ${accountId} \u6267\u884C\u5B8C\u6574\u5F52\u56E0\u56DE\u6EAF\uFF0C\u521B\u5EFA ${attributionTasks.length} \u4E2A\u4EFB\u52A1`);
        } else {
          const dailyTasks = await this.createDailyAttributionCheck(accountId, profileId);
          tasksCreated += dailyTasks;
        }
        log173.info(`[SmartSync] \u8D26\u53F7 ${accountId} \u589E\u91CF\u540C\u6B65\u5B8C\u6210\uFF0C\u5171\u521B\u5EFA ${tasksCreated} \u4E2A\u4EFB\u52A1`);
        return tasksCreated;
      }
      /**
       * 检查是否需要完整归因回溯
       */
      async checkNeedsFullAttribution(accountId) {
        const db = await getDb();
        if (!db) return true;
        const [lastFullAttribution] = await db.select({ completedAt: reportJobs.completedAt }).from(reportJobs).where(
          and(
            eq(reportJobs.accountId, accountId),
            eq(reportJobs.status, "completed"),
            sql`JSON_EXTRACT(request_payload, '$.metadata.isFullAttribution') = true`
          )
        ).orderBy(sql`completed_at DESC`).limit(1);
        if (!lastFullAttribution?.completedAt) {
          return true;
        }
        const lastDate = new Date(lastFullAttribution.completedAt);
        const daysSinceLastFull = Math.floor((Date.now() - lastDate.getTime()) / (1e3 * 60 * 60 * 24));
        return daysSinceLastFull >= SYNC_CONFIG.incremental.fullAttributionFrequency;
      }
      /**
       * 创建日常归因校验任务
       */
      async createDailyAttributionCheck(accountId, profileId) {
        let tasksCreated = 0;
        const { dailyAttributionCheck, attribution } = SYNC_CONFIG.incremental;
        const today = /* @__PURE__ */ new Date();
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() - dailyAttributionCheck);
        for (const adType of ["SP", "SB", "SD"]) {
          const maxDays = Math.min(dailyAttributionCheck, attribution[adType]);
          const checkStartDate = new Date(today);
          checkStartDate.setDate(checkStartDate.getDate() - maxDays);
          await this.asyncReportService.createReportJob({
            accountId,
            profileId,
            adType,
            startDate: checkStartDate.toISOString().split("T")[0],
            endDate: today.toISOString().split("T")[0]
          });
          tasksCreated++;
        }
        return tasksCreated;
      }
      /**
       * 获取同步统计信息
       */
      async getSyncStats(accountId) {
        const db = await getDb();
        const mode = await this.getSyncMode(accountId);
        if (!db) {
          return {
            mode,
            pendingTasks: 0,
            completedTasks: 0,
            failedTasks: 0,
            estimatedDailyTasks: 0
          };
        }
        const stats4 = await db.select({
          status: reportJobs.status,
          count: sql`COUNT(*)`
        }).from(reportJobs).where(eq(reportJobs.accountId, accountId)).groupBy(reportJobs.status);
        const statusMap = stats4.reduce((acc, s) => {
          acc[s.status] = s.count;
          return acc;
        }, {});
        let initializationProgress;
        if (mode === "initialization") {
          const progress = await accountInitializationService.getInitializationProgress(accountId);
          initializationProgress = progress.progress;
        }
        const database = await db;
        if (!database) {
          return {
            mode,
            initializationProgress,
            lastSyncAt: void 0,
            pendingTasks: 0,
            completedTasks: 0,
            failedTasks: 0,
            estimatedDailyTasks: 0
          };
        }
        const [lastSync] = await database.select({ completedAt: reportJobs.completedAt }).from(reportJobs).where(
          and(
            eq(reportJobs.accountId, accountId),
            eq(reportJobs.status, "completed")
          )
        ).orderBy(sql`completed_at DESC`).limit(1);
        const estimatedDailyTasks = mode === "incremental" ? 6 : 0;
        return {
          mode,
          initializationProgress,
          lastSyncAt: lastSync?.completedAt || void 0,
          pendingTasks: (statusMap["pending"] || 0) + (statusMap["submitted"] || 0) + (statusMap["processing"] || 0),
          completedTasks: statusMap["completed"] || 0,
          failedTasks: statusMap["failed"] || 0,
          estimatedDailyTasks
        };
      }
      /**
       * 比较初始化模式和增量模式的任务数量
       * 
       * 新策略（方案四）：
       * - 热数据：3天切片 × 3种广告类型 = 每个时间段9个任务
       * - 冷数据：14天切片 × 3种广告类型 = 每个时间段3个任务
       * - 单个任务数据量大幅降低，处理更稳定
       */
      getTaskComparison() {
        const { initialization, incremental } = SYNC_CONFIG;
        const adTypes = 3;
        const hotDataSlices = Math.ceil(initialization.hotData.days / initialization.hotData.sliceSize);
        const initHotData = hotDataSlices * adTypes;
        const coldDataDays = initialization.coldData.endDay - initialization.coldData.startDay;
        const coldDataSlices = Math.ceil(coldDataDays / initialization.coldData.sliceSize);
        const initColdData = coldDataSlices * adTypes;
        const initTotal = initHotData + initColdData;
        const dailyTasks = adTypes;
        const dailyAttributionTasks = adTypes;
        const incrementalDaily = dailyTasks + dailyAttributionTasks;
        const spAttributionSlices = Math.ceil(incremental.attribution.SP / 7);
        const sbAttributionSlices = Math.ceil(incremental.attribution.SB / 7);
        const sdAttributionSlices = Math.ceil(incremental.attribution.SD / 7);
        const weeklyAttribution = spAttributionSlices + sbAttributionSlices + sdAttributionSlices;
        const yearlyWithoutInit = initTotal * 365;
        const yearlyWithInit = initTotal + incrementalDaily * 365 + weeklyAttribution * 52;
        const savingsPercent = Math.round((1 - yearlyWithInit / yearlyWithoutInit) * 100);
        return {
          initialization: {
            hotData: initHotData,
            coldData: initColdData,
            total: initTotal,
            details: `\u70ED\u6570\u636E: ${hotDataSlices}\u5207\u7247\xD7${adTypes}\u7C7B\u578B=${initHotData}\u4EFB\u52A1, \u51B7\u6570\u636E: ${coldDataSlices}\u5207\u7247\xD7${adTypes}\u7C7B\u578B=${initColdData}\u4EFB\u52A1`
          },
          incremental: {
            daily: incrementalDaily,
            weeklyAttribution,
            total: incrementalDaily * 7 + weeklyAttribution
            // 每周总任务
          },
          savingsPercent
        };
      }
    };
    smartSyncService = new SmartSyncService();
  }
});

