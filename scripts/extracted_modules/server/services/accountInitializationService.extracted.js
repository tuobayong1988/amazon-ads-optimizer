// Extracted from production dist/index.js
// Original module: server/services/accountInitializationService.ts
// Lines: 365

var log172, INITIALIZATION_CONFIG, AccountInitializationService, accountInitializationService;
var init_accountInitializationService2 = __esm({
  "server/services/accountInitializationService.ts"() {
    "use strict";
    init_budgetPortfolioOptimizer();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_asyncReportService();
    init_logger();
    log172 = createModuleLogger("AccountInitialization");
    INITIALIZATION_CONFIG = {
      // 热数据配置
      hotData: {
        days: 90,
        sliceSize: 7,
        // 7天一个切片
        priority: "high"
      },
      // 冷数据配置
      coldData: {
        startDay: 91,
        endDay: 365,
        sliceSize: 30,
        // 30天一个切片
        priority: "low"
      },
      // 广告类型
      adProducts: ["SPONSORED_PRODUCTS", "SPONSORED_BRANDS", "SPONSORED_DISPLAY"],
      // 报告类型
      reportTypes: {
        SPONSORED_PRODUCTS: ["spCampaigns", "spAdGroups", "spKeywords", "spTargets"],
        SPONSORED_BRANDS: ["sbCampaigns", "sbAdGroups", "sbKeywords", "sbTargets"],
        SPONSORED_DISPLAY: ["sdCampaigns", "sdAdGroups", "sdTargets"]
      }
    };
    AccountInitializationService = class {
      static {
        __name(this, "AccountInitializationService");
      }
      asyncReportService;
      constructor() {
        this.asyncReportService = new AsyncReportService();
      }
      /**
       * 开始账号初始化
       */
      async startInitialization(accountId) {
        const db = await getDb();
        if (!db) return { success: false, message: "\u6570\u636E\u5E93\u4E0D\u53EF\u7528" };
        const [account] = await db.select().from(adAccounts).where(eq(adAccounts.id, accountId)).limit(1);
        if (!account) {
          return { success: false, message: "\u8D26\u53F7\u4E0D\u5B58\u5728" };
        }
        if (!account.profileId) {
          return { success: false, message: "\u8D26\u53F7\u672A\u914D\u7F6EprofileId" };
        }
        if (account.initializationStatus === "initializing") {
          return { success: false, message: "\u8D26\u53F7\u6B63\u5728\u521D\u59CB\u5316\u4E2D" };
        }
        if (account.initializationStatus === "completed") {
          return { success: false, message: "\u8D26\u53F7\u5DF2\u5B8C\u6210\u521D\u59CB\u5316" };
        }
        log172.info(`[AccountInit] \u5F00\u59CB\u521D\u59CB\u5316\u8D26\u53F7 ${accountId} (${account.accountName})`);
        await db.update(adAccounts).set({
          initializationStatus: "initializing",
          initializationStartedAt: sql`NOW()`,
          initializationProgress: 0,
          initializationError: null
        }).where(eq(adAccounts.id, accountId));
        const phases = [];
        const hotDataTasks = await this.createHotDataTasks(accountId, account.profileId);
        phases.push({ phase: "hot_data", totalTasks: hotDataTasks });
        const coldDataTasks = await this.createColdDataTasks(accountId, account.profileId);
        phases.push({ phase: "cold_data", totalTasks: coldDataTasks });
        const structureTasks = await this.createStructureDataTasks(accountId, account.profileId);
        phases.push({ phase: "structure_data", totalTasks: structureTasks });
        for (const { phase, totalTasks: totalTasks2 } of phases) {
          await db.insert(accountInitializationProgress).values({
            accountId,
            phase,
            phaseStatus: "pending",
            totalTasks: totalTasks2,
            completedTasks: 0,
            failedTasks: 0
          }).onDuplicateKeyUpdate({
            set: {
              phaseStatus: "pending",
              totalTasks: totalTasks2,
              completedTasks: 0,
              failedTasks: 0,
              startedAt: null,
              completedAt: null,
              errorMessage: null
            }
          });
        }
        const totalTasks = phases.reduce((sum2, p) => sum2 + p.totalTasks, 0);
        log172.info(`[AccountInit] \u8D26\u53F7 ${accountId} \u521D\u59CB\u5316\u4EFB\u52A1\u521B\u5EFA\u5B8C\u6210\uFF0C\u5171 ${totalTasks} \u4E2A\u4EFB\u52A1`);
        return {
          success: true,
          message: `\u521D\u59CB\u5316\u4EFB\u52A1\u5DF2\u521B\u5EFA\uFF0C\u5171 ${totalTasks} \u4E2A\u4EFB\u52A1`,
          phases: phases.map((p) => ({ phase: p.phase, totalTasks: p.totalTasks }))
        };
      }
      /**
       * 创建热数据任务（最近90天）
       */
      async createHotDataTasks(accountId, profileId) {
        const { days, sliceSize } = INITIALIZATION_CONFIG.hotData;
        let taskCount = 0;
        const today = /* @__PURE__ */ new Date();
        const slices = [];
        for (let i = 0; i < days; i += sliceSize) {
          const endDay = Math.min(i + sliceSize - 1, days - 1);
          const startDate = new Date(today);
          startDate.setDate(startDate.getDate() - endDay - 1);
          const endDate = new Date(today);
          endDate.setDate(endDate.getDate() - i - 1);
          slices.push({
            startDate: startDate.toISOString().split("T")[0],
            endDate: endDate.toISOString().split("T")[0]
          });
        }
        for (const adProduct of INITIALIZATION_CONFIG.adProducts) {
          const reportTypes = INITIALIZATION_CONFIG.reportTypes[adProduct];
          for (const reportType of reportTypes) {
            for (const slice of slices) {
              await this.asyncReportService.createReportJobExtended({
                accountId,
                profileId,
                reportType,
                adProduct,
                startDate: slice.startDate,
                endDate: slice.endDate,
                priority: "high",
                metadata: {
                  initPhase: "hot_data",
                  isInitialization: true
                }
              });
              taskCount++;
            }
          }
        }
        log172.info(`[AccountInit] \u8D26\u53F7 ${accountId} \u70ED\u6570\u636E\u4EFB\u52A1\u521B\u5EFA\u5B8C\u6210: ${taskCount} \u4E2A`);
        return taskCount;
      }
      /**
       * 创建冷数据任务（91-365天）
       */
      async createColdDataTasks(accountId, profileId) {
        const { startDay, endDay, sliceSize } = INITIALIZATION_CONFIG.coldData;
        let taskCount = 0;
        const today = /* @__PURE__ */ new Date();
        const slices = [];
        for (let i = startDay; i <= endDay; i += sliceSize) {
          const sliceEnd = Math.min(i + sliceSize - 1, endDay);
          const startDate = new Date(today);
          startDate.setDate(startDate.getDate() - sliceEnd - 1);
          const endDate = new Date(today);
          endDate.setDate(endDate.getDate() - i);
          slices.push({
            startDate: startDate.toISOString().split("T")[0],
            endDate: endDate.toISOString().split("T")[0]
          });
        }
        for (const adProduct of INITIALIZATION_CONFIG.adProducts) {
          const reportType = adProduct === "SPONSORED_PRODUCTS" ? "spCampaigns" : adProduct === "SPONSORED_BRANDS" ? "sbCampaigns" : "sdCampaigns";
          for (const slice of slices) {
            await this.asyncReportService.createReportJobExtended({
              accountId,
              profileId,
              reportType,
              adProduct,
              startDate: slice.startDate,
              endDate: slice.endDate,
              priority: "low",
              metadata: {
                initPhase: "cold_data",
                isInitialization: true
              }
            });
            taskCount++;
          }
        }
        log172.info(`[AccountInit] \u8D26\u53F7 ${accountId} \u51B7\u6570\u636E\u4EFB\u52A1\u521B\u5EFA\u5B8C\u6210: ${taskCount} \u4E2A`);
        return taskCount;
      }
      /**
       * 创建结构数据任务（广告活动、广告组等）
       */
      async createStructureDataTasks(accountId, profileId) {
        let taskCount = 0;
        for (const adProduct of INITIALIZATION_CONFIG.adProducts) {
          taskCount++;
          taskCount++;
          taskCount++;
        }
        log172.info(`[AccountInit] \u8D26\u53F7 ${accountId} \u7ED3\u6784\u6570\u636E\u4EFB\u52A1\u521B\u5EFA\u5B8C\u6210: ${taskCount} \u4E2A`);
        return taskCount;
      }
      /**
       * 获取初始化进度
       */
      async getInitializationProgress(accountId) {
        const db = await getDb();
        if (!db) throw new Error("\u6570\u636E\u5E93\u4E0D\u53EF\u7528");
        const [account] = await db.select().from(adAccounts).where(eq(adAccounts.id, accountId)).limit(1);
        if (!account) {
          throw new Error("\u8D26\u53F7\u4E0D\u5B58\u5728");
        }
        const progressRecords = await db.select().from(accountInitializationProgress).where(eq(accountInitializationProgress.accountId, accountId));
        const phases = progressRecords.map((record2) => ({
          phase: record2.phase,
          status: record2.phaseStatus,
          totalTasks: record2.totalTasks,
          completedTasks: record2.completedTasks,
          failedTasks: record2.failedTasks,
          progressPercent: record2.totalTasks > 0 ? Math.round(record2.completedTasks / record2.totalTasks * 100) : 0
        }));
        const totalTasks = phases.reduce((sum2, p) => sum2 + p.totalTasks, 0);
        const completedTasks = phases.reduce((sum2, p) => sum2 + p.completedTasks, 0);
        const overallProgress = totalTasks > 0 ? Math.round(completedTasks / totalTasks * 100) : 0;
        const remainingTasks = totalTasks - completedTasks;
        const estimatedTimeRemaining = Math.ceil(remainingTasks * 0.5);
        return {
          status: account.initializationStatus || "pending",
          progress: overallProgress,
          phases,
          estimatedTimeRemaining: account.initializationStatus === "initializing" ? estimatedTimeRemaining : void 0,
          startedAt: account.initializationStartedAt || void 0,
          completedAt: account.initializationCompletedAt || void 0,
          error: account.initializationError || void 0
        };
      }
      /**
       * 更新阶段进度
       */
      async updatePhaseProgress(accountId, phase, completedTasks, failedTasks = 0) {
        const db = await getDb();
        if (!db) return;
        const [record2] = await db.select().from(accountInitializationProgress).where(
          and(
            eq(accountInitializationProgress.accountId, accountId),
            eq(accountInitializationProgress.phase, phase)
          )
        ).limit(1);
        if (!record2) return;
        const newCompletedTasks = record2.completedTasks + completedTasks;
        const newFailedTasks = record2.failedTasks + failedTasks;
        const isCompleted = newCompletedTasks + newFailedTasks >= record2.totalTasks;
        await db.update(accountInitializationProgress).set({
          completedTasks: newCompletedTasks,
          failedTasks: newFailedTasks,
          phaseStatus: isCompleted ? newFailedTasks > 0 ? "failed" : "completed" : "in_progress",
          startedAt: record2.startedAt || sql`NOW()`,
          completedAt: isCompleted ? sql`NOW()` : null
        }).where(
          and(
            eq(accountInitializationProgress.accountId, accountId),
            eq(accountInitializationProgress.phase, phase)
          )
        );
        await this.checkAndUpdateOverallStatus(accountId);
      }
      /**
       * 检查并更新整体初始化状态
       */
      async checkAndUpdateOverallStatus(accountId) {
        const db = await getDb();
        if (!db) return;
        const progressRecords = await db.select().from(accountInitializationProgress).where(eq(accountInitializationProgress.accountId, accountId));
        const allCompleted = progressRecords.every((r) => r.phaseStatus === "completed");
        const anyFailed = progressRecords.some((r) => r.phaseStatus === "failed");
        const totalTasks = progressRecords.reduce((sum2, r) => sum2 + r.totalTasks, 0);
        const completedTasks = progressRecords.reduce((sum2, r) => sum2 + r.completedTasks, 0);
        const progress = totalTasks > 0 ? Math.round(completedTasks / totalTasks * 100) : 0;
        if (allCompleted) {
          await db.update(adAccounts).set({
            initializationStatus: "completed",
            initializationCompletedAt: sql`NOW()`,
            initializationProgress: 100
          }).where(eq(adAccounts.id, accountId));
          log172.info(`[AccountInit] \u8D26\u53F7 ${accountId} \u521D\u59CB\u5316\u5B8C\u6210\uFF01`);
        } else if (anyFailed) {
          const failedPhases = progressRecords.filter((r) => r.phaseStatus === "failed").map((r) => r.phase).join(", ");
          await db.update(adAccounts).set({
            initializationStatus: "failed",
            initializationProgress: progress,
            initializationError: `\u4EE5\u4E0B\u9636\u6BB5\u5931\u8D25: ${failedPhases}`
          }).where(eq(adAccounts.id, accountId));
        } else {
          await db.update(adAccounts).set({
            initializationProgress: progress
          }).where(eq(adAccounts.id, accountId));
        }
      }
      /**
       * 重试失败的初始化
       */
      async retryFailedInitialization(accountId) {
        const db = await getDb();
        if (!db) return { success: false, message: "\u6570\u636E\u5E93\u4E0D\u53EF\u7528" };
        const failedPhases = await db.select().from(accountInitializationProgress).where(
          and(
            eq(accountInitializationProgress.accountId, accountId),
            eq(accountInitializationProgress.phaseStatus, "failed")
          )
        );
        if (failedPhases.length === 0) {
          return { success: false, message: "\u6CA1\u6709\u5931\u8D25\u7684\u9636\u6BB5\u9700\u8981\u91CD\u8BD5" };
        }
        for (const phase of failedPhases) {
          await db.update(accountInitializationProgress).set({
            phaseStatus: "pending",
            completedTasks: 0,
            failedTasks: 0,
            startedAt: null,
            completedAt: null,
            errorMessage: null
          }).where(eq(accountInitializationProgress.id, phase.id));
        }
        await db.update(adAccounts).set({
          initializationStatus: "initializing",
          initializationError: null
        }).where(eq(adAccounts.id, accountId));
        return {
          success: true,
          message: `\u5DF2\u91CD\u7F6E ${failedPhases.length} \u4E2A\u5931\u8D25\u9636\u6BB5\uFF0C\u5C06\u91CD\u65B0\u521D\u59CB\u5316`
        };
      }
      /**
       * 检查账号是否已完成初始化
       */
      async isInitializationCompleted(accountId) {
        const db = await getDb();
        if (!db) return false;
        const [account] = await db.select({ status: adAccounts.initializationStatus }).from(adAccounts).where(eq(adAccounts.id, accountId)).limit(1);
        return account?.status === "completed";
      }
      /**
       * 获取需要初始化的账号列表
       */
      async getPendingInitializationAccounts() {
        const db = await getDb();
        if (!db) return [];
        const accounts = await db.select({
          id: adAccounts.id,
          accountName: adAccounts.accountName,
          marketplace: adAccounts.marketplace,
          status: adAccounts.initializationStatus
        }).from(adAccounts).where(eq(adAccounts.initializationStatus, "pending"));
        return accounts.map((a) => ({
          id: a.id,
          accountName: a.accountName,
          marketplace: a.marketplace,
          status: a.status || "pending"
        }));
      }
    };
    accountInitializationService = new AccountInitializationService();
  }
});

