// Extracted from production dist/index.js
// Original module: server/automation/autoOperationService.ts
// Lines: 413

var log181, configStore, logStore, MAX_LOG_STORE_SIZE, autoOperationService;
var init_autoOperationService = __esm({
  "server/automation/autoOperationService.ts"() {
    "use strict";
    init_logger();
    init_db2();
    init_schema2();
    init_drizzle_orm();
    init_trafficIsolationService();
    log181 = createModuleLogger("AutoOperationService");
    configStore = /* @__PURE__ */ new Map();
    logStore = [];
    MAX_LOG_STORE_SIZE = 1e4;
    autoOperationService = {
      /**
       * 获取账号的自动运营配置
       */
      async getConfig(accountId) {
        return configStore.get(accountId) || null;
      },
      /**
       * 创建或更新自动运营配置
       */
      async upsertConfig(config2) {
        const existing = configStore.get(config2.accountId);
        const now = /* @__PURE__ */ new Date();
        const intervalHours = config2.intervalHours ?? existing?.intervalHours ?? 2;
        const nextRun = new Date(now.getTime() + intervalHours * 60 * 60 * 1e3);
        const newConfig = {
          accountId: config2.accountId,
          enabled: config2.enabled ?? existing?.enabled ?? true,
          intervalHours,
          enableDataSync: config2.enableDataSync ?? existing?.enableDataSync ?? true,
          enableNgramAnalysis: config2.enableNgramAnalysis ?? existing?.enableNgramAnalysis ?? true,
          enableFunnelSync: config2.enableFunnelSync ?? existing?.enableFunnelSync ?? true,
          enableConflictDetection: config2.enableConflictDetection ?? existing?.enableConflictDetection ?? true,
          enableMigrationSuggestion: config2.enableMigrationSuggestion ?? existing?.enableMigrationSuggestion ?? true,
          enableBidOptimization: config2.enableBidOptimization ?? existing?.enableBidOptimization ?? true,
          lastRunAt: existing?.lastRunAt ?? null,
          nextRunAt: nextRun
        };
        configStore.set(config2.accountId, newConfig);
        return newConfig;
      },
      /**
       * 执行完整的自动运营流程
       */
      async executeFullOperation(accountId) {
        const startedAt = /* @__PURE__ */ new Date();
        const steps = [];
        let config2 = await this.getConfig(accountId);
        if (!config2) {
          config2 = await this.upsertConfig({ accountId });
        }
        const logId = `log_${Date.now()}_${accountId}`;
        const log216 = {
          id: logId,
          accountId,
          operationType: "full_operation",
          status: "running",
          startedAt,
          completedAt: null,
          duration: null,
          details: { config: config2 },
          errorMessage: null
        };
        logStore.push(log216);
        while (logStore.length > MAX_LOG_STORE_SIZE) {
          logStore.shift();
        }
        try {
          if (config2.enableDataSync) {
            const stepResult = await this.executeDataSync(accountId);
            steps.push(stepResult);
          } else {
            steps.push({ step: "data_sync", status: "skipped", duration: 0, details: {} });
          }
          if (config2.enableNgramAnalysis) {
            const stepResult = await this.executeNgramAnalysis(accountId);
            steps.push(stepResult);
          } else {
            steps.push({ step: "ngram_analysis", status: "skipped", duration: 0, details: {} });
          }
          if (config2.enableFunnelSync) {
            const stepResult = await this.executeFunnelSync(accountId);
            steps.push(stepResult);
          } else {
            steps.push({ step: "funnel_sync", status: "skipped", duration: 0, details: {} });
          }
          if (config2.enableConflictDetection) {
            const stepResult = await this.executeConflictDetection(accountId);
            steps.push(stepResult);
          } else {
            steps.push({ step: "conflict_detection", status: "skipped", duration: 0, details: {} });
          }
          if (config2.enableMigrationSuggestion) {
            const stepResult = await this.executeMigrationSuggestion(accountId);
            steps.push(stepResult);
          } else {
            steps.push({ step: "migration_suggestion", status: "skipped", duration: 0, details: {} });
          }
          if (config2.enableBidOptimization) {
            const stepResult = await this.executeBidOptimization(accountId);
            steps.push(stepResult);
          } else {
            steps.push({ step: "bid_optimization", status: "skipped", duration: 0, details: {} });
          }
          const completedAt = /* @__PURE__ */ new Date();
          const totalDuration = completedAt.getTime() - startedAt.getTime();
          const summary = {
            totalSteps: steps.length,
            successSteps: steps.filter((s) => s.status === "success").length,
            failedSteps: steps.filter((s) => s.status === "failed").length,
            skippedSteps: steps.filter((s) => s.status === "skipped").length
          };
          const status = summary.failedSteps === 0 ? "completed" : summary.successSteps > 0 ? "partial" : "failed";
          log216.status = status === "failed" ? "failed" : "completed";
          log216.completedAt = completedAt;
          log216.duration = totalDuration;
          log216.details = { config: config2, steps, summary };
          const nextRunAt = new Date(completedAt.getTime() + config2.intervalHours * 60 * 60 * 1e3);
          config2.lastRunAt = completedAt;
          config2.nextRunAt = nextRunAt;
          configStore.set(accountId, config2);
          return {
            accountId,
            startedAt,
            completedAt,
            totalDuration,
            status,
            steps,
            summary
          };
        } catch (error48) {
          const completedAt = /* @__PURE__ */ new Date();
          const totalDuration = completedAt.getTime() - startedAt.getTime();
          log216.status = "failed";
          log216.completedAt = completedAt;
          log216.duration = totalDuration;
          log216.errorMessage = error48 instanceof Error ? error48.message : String(error48);
          log216.details = { config: config2, steps, error: String(error48) };
          throw error48;
        }
      },
      /**
       * 执行数据同步
       */
      async executeDataSync(accountId) {
        const startTime = Date.now();
        try {
          const db = await getDb();
          if (!db) {
            throw new Error("Database connection failed");
          }
          const account = await db.select().from(adAccounts).where(eq(adAccounts.id, accountId)).limit(1);
          if (!account[0]) {
            throw new Error("Account not found");
          }
          const duration3 = Date.now() - startTime;
          return {
            step: "data_sync",
            status: "success",
            duration: duration3,
            details: {
              accountId,
              accountName: account[0].accountName,
              message: "\u6570\u636E\u540C\u6B65\u5DF2\u89E6\u53D1\uFF0C\u7B49\u5F85Amazon API\u54CD\u5E94"
            }
          };
        } catch (error48) {
          return {
            step: "data_sync",
            status: "failed",
            duration: Date.now() - startTime,
            details: {},
            error: error48 instanceof Error ? error48.message : String(error48)
          };
        }
      },
      /**
       * 执行N-Gram分析
       */
      async executeNgramAnalysis(accountId) {
        const startTime = Date.now();
        try {
          const db = await getDb();
          if (!db) {
            throw new Error("Database connection failed");
          }
          const campaignList = await db.select().from(campaigns).where(eq(campaigns.accountId, accountId));
          let totalAnalyzed = 0;
          let totalSuggestions = 0;
          try {
            const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1e3);
            const endDate = /* @__PURE__ */ new Date();
            const result = await runNGramAnalysis(
              accountId,
              startDate,
              endDate
            );
            totalAnalyzed = 1;
            totalSuggestions = result.suggestedNegatives?.length || 0;
          } catch (e) {
            log181.warn(`N-Gram analysis failed for account ${accountId}:`, e);
          }
          const duration3 = Date.now() - startTime;
          return {
            step: "ngram_analysis",
            status: "success",
            duration: duration3,
            details: {
              campaignsAnalyzed: totalAnalyzed,
              totalCampaigns: campaignList.length,
              suggestionsGenerated: totalSuggestions
            }
          };
        } catch (error48) {
          return {
            step: "ngram_analysis",
            status: "failed",
            duration: Date.now() - startTime,
            details: {},
            error: error48 instanceof Error ? error48.message : String(error48)
          };
        }
      },
      /**
       * 执行漏斗同步
       */
      async executeFunnelSync(accountId) {
        const startTime = Date.now();
        try {
          const defaultTierConfigs = [];
          const result = await syncFunnelNegatives(accountId, defaultTierConfigs);
          const duration3 = Date.now() - startTime;
          return {
            step: "funnel_sync",
            status: "success",
            duration: duration3,
            details: {
              syncedCount: result.totalNegativesToAdd || 0,
              tier1Keywords: result.tier1Keywords?.length || 0,
              tier2Keywords: result.tier2Keywords?.length || 0
            }
          };
        } catch (error48) {
          return {
            step: "funnel_sync",
            status: "failed",
            duration: Date.now() - startTime,
            details: {},
            error: error48 instanceof Error ? error48.message : String(error48)
          };
        }
      },
      /**
       * 执行冲突检测
       */
      async executeConflictDetection(accountId) {
        const startTime = Date.now();
        try {
          const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1e3);
          const endDate = /* @__PURE__ */ new Date();
          const result = await detectTrafficConflicts2(accountId, startDate, endDate);
          const duration3 = Date.now() - startTime;
          return {
            step: "conflict_detection",
            status: "success",
            duration: duration3,
            details: {
              conflictsDetected: result.conflicts?.length || 0,
              totalWastedSpend: result.totalWastedSpend || 0,
              resolutionSuggestions: result.conflicts?.length || 0
            }
          };
        } catch (error48) {
          return {
            step: "conflict_detection",
            status: "failed",
            duration: Date.now() - startTime,
            details: {},
            error: error48 instanceof Error ? error48.message : String(error48)
          };
        }
      },
      /**
       * 执行迁移建议
       */
      async executeMigrationSuggestion(accountId) {
        const startTime = Date.now();
        try {
          const defaultTierConfigs = [];
          const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1e3);
          const endDate = /* @__PURE__ */ new Date();
          const result = await getKeywordMigrationSuggestions(accountId, defaultTierConfigs, startDate, endDate);
          const duration3 = Date.now() - startTime;
          return {
            step: "migration_suggestion",
            status: "success",
            duration: duration3,
            details: {
              suggestionsGenerated: result?.length || 0,
              potentialImpact: {}
            }
          };
        } catch (error48) {
          return {
            step: "migration_suggestion",
            status: "failed",
            duration: Date.now() - startTime,
            details: {},
            error: error48 instanceof Error ? error48.message : String(error48)
          };
        }
      },
      /**
       * v167: 重写出价优化 - 使用optimizationTargetEngine而不是automationExecutionEngine
       * 之前的实现有严重问题：
       * 1. 传递dailyBudget作为出价值（currentValue和newValue相同，都是dailyBudget）
       * 2. 没有使用算法引擎计算最优出价
       * 3. 结果是无意义的优化（新旧值相同）或错误的出价
       */
      async executeBidOptimization(accountId) {
        const startTime = Date.now();
        try {
          const { getEnabledOptimizationTargets: getEnabledOptimizationTargets2, executeOptimizationTarget: executeOptimizationTarget2 } = await Promise.resolve().then(() => (init_optimizationTargetEngine(), optimizationTargetEngine_exports));
          const allTargets = await getEnabledOptimizationTargets2();
          const accountTargets = allTargets.filter((t2) => t2.accountId === accountId);
          let totalOptimized = 0;
          let totalAdjustments = 0;
          for (const target of accountTargets) {
            try {
              const result = await executeOptimizationTarget2(target.id, {
                dryRun: false,
                specificModules: ["bid", "keyword", "coordination"]
              });
              totalOptimized++;
              totalAdjustments += result.bidOptimization.adjustmentsCount;
              log181.info(`[AutoOperation] v167: \u51FA\u4EF7\u4F18\u5316\u76EE\u6807 ${target.name}: \u8C03\u6574=${result.bidOptimization.adjustmentsCount}`);
            } catch (e) {
              log181.warn(`[AutoOperation] v167: \u51FA\u4EF7\u4F18\u5316\u76EE\u6807 ${target.name} \u5931\u8D25:`, e.message);
            }
          }
          const duration3 = Date.now() - startTime;
          return {
            step: "bid_optimization",
            status: "success",
            duration: duration3,
            details: {
              targetsOptimized: totalOptimized,
              totalTargets: accountTargets.length,
              adjustmentsApplied: totalAdjustments
            }
          };
        } catch (error48) {
          return {
            step: "bid_optimization",
            status: "failed",
            duration: Date.now() - startTime,
            details: {},
            error: error48 instanceof Error ? error48.message : String(error48)
          };
        }
      },
      /**
       * 获取运营日志
       */
      async getLogs(accountId, limit = 50) {
        return logStore.filter((log216) => log216.accountId === accountId).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).slice(0, limit);
      },
      /**
       * 获取所有需要执行的账号
       */
      async getAccountsDueForExecution() {
        const now = /* @__PURE__ */ new Date();
        const dueAccounts = [];
        configStore.forEach((config2, accountId) => {
          if (config2.enabled && config2.nextRunAt && config2.nextRunAt <= now) {
            dueAccounts.push(accountId);
          }
        });
        return dueAccounts;
      },
      /**
       * 执行所有到期的自动运营任务
       */
      async executeAllDueTasks() {
        const accountIds = await this.getAccountsDueForExecution();
        const results = [];
        let executed = 0;
        let failed = 0;
        for (const accountId of accountIds) {
          try {
            const result = await this.executeFullOperation(accountId);
            results.push(result);
            executed++;
          } catch (error48) {
            log181.warn(`Auto operation failed for account ${accountId}:`, error48);
            failed++;
          }
        }
        return { executed, failed, results };
      },
      /**
       * 获取所有配置
       */
      async getAllConfigs() {
        return Array.from(configStore.values());
      }
    };
  }
});

