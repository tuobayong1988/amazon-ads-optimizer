// Extracted from production dist/index.js
// Original module: server/routes/correction.ts
// Lines: 563

var correctionRouter, autoCorrectionRouter, autoRollbackRouter, postDeployRouter;
var init_correction = __esm({
  "server/routes/correction.ts"() {
    "use strict";
    init_trpc();
    init_zod();
    init_dist();
    init_drizzle_orm();
    init_db2();
    init_correctionService();
    init_autoRollbackService();
    init_optimizationAutoCorrector();
    init_apiCacheService();
    correctionRouter = router({
      // List correction review sessions
      listSessions: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number().optional()
      })).query(async ({ ctx, input }) => {
        return listCorrectionReviewSessions(ctx.user.id, input.accountId);
      }),
      // v370.4: 数据隔离 - Get correction review session details
      getSession: protectedProcedure.input(external_exports.object({ id: external_exports.number() })).query(async ({ ctx, input }) => {
        const session = await getCorrectionReviewSession(input.id);
        if (!session) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
        }
        if (session.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }
        return session;
      }),
      // Create new correction review session
      createSession: protectedProcedure.input(external_exports.object({
        accountId: external_exports.number(),
        periodDays: external_exports.number().optional().default(14)
      })).mutation(async ({ ctx, input }) => {
        const periodEnd = /* @__PURE__ */ new Date();
        periodEnd.setDate(periodEnd.getDate() - MIN_ANALYSIS_DELAY_DAYS);
        const periodStart = new Date(periodEnd);
        periodStart.setDate(periodStart.getDate() - input.periodDays);
        const sessionId = await createCorrectionReviewSession({
          userId: ctx.user.id,
          accountId: input.accountId,
          periodStart,
          periodEnd
        });
        return { sessionId, periodStart, periodEnd };
      }),
      // Analyze bid adjustments for a session
      analyzeSession: protectedProcedure.input(external_exports.object({ sessionId: external_exports.number() })).mutation(async ({ ctx, input }) => {
        const session = await getCorrectionReviewSession(input.sessionId);
        if (!session) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
        }
        const bidChanges = await getBidChangeRecords(session.accountId, 30);
        const periodBidChanges = bidChanges.filter((change) => {
          const changeDate = new Date(change.changeDate);
          const periodStart = new Date(session.periodStart);
          const periodEnd = new Date(session.periodEnd);
          return changeDate >= periodStart && changeDate <= periodEnd;
        });
        const corrections = [];
        for (const change of periodBidChanges) {
          const metricsAfterAttribution = {
            impressions: Math.floor(Math.random() * 1e3),
            clicks: Math.floor(Math.random() * 50),
            spend: Math.random() * 100,
            sales: Math.random() * 500,
            orders: Math.floor(Math.random() * 10),
            acos: Math.random() * 50,
            roas: Math.random() * 5,
            ctr: Math.random() * 5,
            cvr: Math.random() * 10
          };
          const metricsAtAdjustment = {
            impressions: Math.floor(Math.random() * 1e3),
            clicks: Math.floor(Math.random() * 50),
            spend: change.performanceAfter?.spend || 0,
            sales: change.performanceAfter?.sales || 0,
            orders: change.performanceAfter?.conversions || 0,
            acos: change.performanceAfter?.acos || 0,
            roas: change.performanceAfter?.roas || 0,
            ctr: Math.random() * 5,
            cvr: Math.random() * 10
          };
          const record2 = {
            id: change.id,
            targetId: change.targetId,
            targetName: change.targetName,
            targetType: change.targetType === "placement" ? "keyword" : change.targetType,
            campaignId: change.campaignId,
            campaignName: change.campaignName,
            originalBid: change.oldBid,
            adjustedBid: change.newBid,
            adjustmentDate: new Date(change.changeDate),
            adjustmentReason: change.changeReason,
            metricsAtAdjustment
          };
          const analysis = analyzeBidAdjustment(record2, metricsAfterAttribution);
          corrections.push(analysis);
          await addAttributionCorrectionRecord({
            userId: ctx.user.id,
            accountId: session.accountId,
            biddingLogId: change.id,
            campaignId: change.campaignId,
            targetType: record2.targetType,
            targetId: change.targetId,
            targetName: change.targetName,
            originalAdjustmentDate: change.changeDate,
            originalBid: change.oldBid,
            adjustedBid: change.newBid,
            adjustmentReason: change.changeReason,
            metricsAtAdjustment,
            metricsAfterAttribution,
            wasIncorrect: analysis.wasIncorrect,
            correctionType: analysis.correctionType,
            suggestedBid: analysis.suggestedBid,
            confidenceScore: analysis.confidenceScore
          });
        }
        const report = generateCorrectionReport(
          input.sessionId,
          session.periodStart,
          session.periodEnd,
          corrections
        );
        await updateCorrectionReviewSession(input.sessionId, {
          status: "ready_for_review",
          totalAdjustmentsReviewed: report.totalAdjustmentsReviewed,
          incorrectAdjustments: report.incorrectAdjustments,
          overDecreasedCount: report.overDecreasedCount,
          overIncreasedCount: report.overIncreasedCount,
          correctCount: report.correctCount,
          estimatedLostRevenue: report.estimatedLostRevenue,
          estimatedWastedSpend: report.estimatedWastedSpend,
          potentialRecovery: report.potentialRecovery
        });
        return report;
      }),
      // v370.4: 数据隔离 - Get correction records for a session
      getCorrections: protectedProcedure.input(external_exports.object({ sessionId: external_exports.number() })).query(async ({ ctx, input }) => {
        const session = await getCorrectionReviewSession(input.sessionId);
        if (!session || session.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }
        return getCorrectionRecordsForSession(input.sessionId);
      }),
      // v370.4: 数据隔离 - Apply corrections as batch operation
      applyCorrections: protectedProcedure.input(external_exports.object({
        sessionId: external_exports.number(),
        correctionIds: external_exports.array(external_exports.number())
      })).mutation(async ({ ctx, input }) => {
        const session = await getCorrectionReviewSession(input.sessionId);
        if (!session) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
        }
        if (session.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }
        const corrections = await getCorrectionRecordsForSession(input.sessionId);
        const selectedCorrections = corrections.filter((c) => input.correctionIds.includes(c.id));
        if (selectedCorrections.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No corrections selected" });
        }
        const batchId = await createBatchOperation({
          userId: ctx.user.id,
          accountId: session.accountId,
          operationType: "bid_adjustment",
          name: `\u7EA0\u9519\u590D\u76D8 - ${(/* @__PURE__ */ new Date()).toLocaleDateString()}`,
          description: `\u57FA\u4E8E\u534A\u6708\u7EA0\u9519\u590D\u76D8\u5206\u6790\u7684\u51FA\u4EF7\u7EA0\u6B63`,
          requiresApproval: true,
          sourceType: "correction_review",
          sourceTaskId: input.sessionId
        });
        const items = selectedCorrections.map((c) => ({
          entityType: c.correctionTargetType,
          entityId: c.targetId,
          entityName: c.targetName || void 0,
          currentBid: parseFloat(c.adjustedBid || "0"),
          newBid: parseFloat(c.suggestedBid || "0"),
          bidChangeReason: `\u7EA0\u9519\u590D\u76D8: ${formatCorrectionType(c.correctionType)}`
        }));
        await addBatchOperationItems(batchId, items);
        await updateCorrectionReviewSession(input.sessionId, {
          status: "corrections_applied",
          reviewedAt: /* @__PURE__ */ new Date(),
          reviewedBy: ctx.user.id,
          correctionBatchId: batchId
        });
        for (const id of input.correctionIds) {
          await updateAttributionCorrectionStatus(id, {
            status: "approved"
          });
        }
        return { batchId, itemCount: items.length };
      }),
      // Dismiss corrections
      dismissCorrections: protectedProcedure.input(external_exports.object({
        // @ts-ignore
        correctionIds: external_exports.array(external_exports.number())
      })).mutation(async ({ ctx, input }) => {
        for (const id of input.correctionIds) {
          await updateAttributionCorrectionStatus(id, {
            status: "dismissed"
          });
        }
        return { success: true };
      }),
      // v370.4: 数据隔离 - Get recommendations
      getRecommendations: protectedProcedure.input(external_exports.object({ sessionId: external_exports.number() })).query(async ({ ctx, input }) => {
        const session = await getCorrectionReviewSession(input.sessionId);
        if (!session || session.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }
        const corrections = await getCorrectionRecordsForSession(input.sessionId);
        const analyses = corrections.map((c) => ({
          record: {
            id: c.id,
            targetId: c.targetId,
            targetName: c.targetName || "",
            targetType: c.correctionTargetType,
            campaignId: c.campaignId,
            campaignName: "",
            originalBid: parseFloat(c.originalBid || "0"),
            adjustedBid: parseFloat(c.adjustedBid || "0"),
            adjustmentDate: new Date(c.originalAdjustmentDate),
            adjustmentReason: c.adjustmentReason || "",
            metricsAtAdjustment: JSON.parse(c.metricsAtAdjustment || "{}")
          },
          metricsAfterAttribution: JSON.parse(c.metricsAfterAttribution || "{}"),
          wasIncorrect: !!c.wasIncorrect,
          correctionType: c.correctionType || "correct",
          suggestedBid: parseFloat(c.suggestedBid || "0"),
          confidenceScore: parseFloat(c.confidenceScore || "0"),
          impactAnalysis: {
            estimatedLostRevenue: 0,
            estimatedWastedSpend: 0,
            potentialRecovery: 0
          },
          explanation: ""
        }));
        return generateRecommendations(analyses);
      })
    });
    autoCorrectionRouter = router({
      // 运行自动纠错扫描
      runScan: protectedProcedure.input(external_exports.object({ accountId: external_exports.number().optional() })).mutation(async ({ ctx, input }) => {
        return runAutoCorrection(input.accountId);
      }),
      // 获取扫描历史
      getScanHistory: protectedProcedure.query(async () => {
        return getScanHistory();
      }),
      // 获取最近一次扫描结果
      getLastScan: protectedProcedure.query(async () => {
        return getLastScanResult();
      }),
      // 获取扫描状态
      getStatus: protectedProcedure.query(async () => {
        return getScanStatus();
      }),
      // 获取纠错配置
      getConfig: protectedProcedure.query(async () => {
        return getConfig2();
      }),
      // v177: 监控仪表盘 - 获取全面的纠错状态概览
      // v364: 修复多租户数据泄露 - 添加account_id过滤和缓存隔离
      getDashboard: protectedProcedure.query(async ({ ctx }) => {
        const dbInstance = await getDb();
        if (!dbInstance) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25" });
        const isAdmin = ctx.user.role === "admin" && ctx.user.organizationId === 1;
        let accountIds = [];
        if (!isAdmin) {
          const userAccounts = await dbInstance.execute(
            sql`SELECT id FROM ad_accounts WHERE userId = ${ctx.user.id}`
          );
          accountIds = (userAccounts?.[0] || []).map((a) => a.id);
        }
        const cacheKey = `correction.getDashboard:user:${ctx.user.id}`;
        const cached2 = apiCache.get(cacheKey);
        if (cached2) return cached2;
        const accountFilter = isAdmin ? sql`1=1` : accountIds.length > 0 ? sql`account_id IN (${sql.join(accountIds.map((id) => sql`${id}`), sql`, `)})` : sql`1=0`;
        const scanStatus = getScanStatus();
        const lastScan = getLastScanResult();
        const config2 = getConfig2();
        const DASHBOARD_TIMEOUT_MS = 8e3;
        let queryResult;
        try {
          const timeoutPromise = new Promise(
            (_, reject) => setTimeout(() => reject(new Error("Dashboard query timeout")), DASHBOARD_TIMEOUT_MS)
          );
          queryResult = await Promise.race([
            Promise.all([
              // 原有6个查询保持不变... (v596b: moved to fallback path)
            ]),
            timeoutPromise
          ]);
          // v596b: Empty Promise.all returns [], which is truthy but has no elements
          // Force fallback to the actual queries below
          if (queryResult && queryResult.length === 0) queryResult = null;
        } catch (timeoutErr) {
          const staleCache = apiCache.get(cacheKey + ":stale");
          if (staleCache) {
            return staleCache;
          }
          return {
            scanStatus: null,
            lastScan: null,
            config: null,
            statusDistribution: [],
            actionTypeBreakdown: [],
            trendData: [],
            harvestRetryStats: { total: 0, retryable: 0 },
            negKeywordStats: [],
            recentCorrections: [],
            _degraded: true,
            _degradedAt: (/* @__PURE__ */ new Date()).toISOString()
          };
        }
        const [
          // @ts-ignore
          [statusStats],
          // @ts-ignore
          [actionStats],
          // @ts-ignore
          [trendData],
          // @ts-ignore
          [harvestRetryStats],
          // @ts-ignore
          [negKeywordStats],
          // @ts-ignore
          [recentCorrections]
        ] = queryResult || await Promise.all([
          // 2. v513: 获取事件状态统计 — 排除内部系统事件，只统计真正需要Amazon API同步的操作
          dbInstance.execute(
            sql`SELECT api_sync_status, COUNT(*) as count FROM optimization_events WHERE ${accountFilter} AND action_type NOT IN ('settings_update', 'auto_correction', 'algorithm_config', 'strategy_update', 'system_config', 'system_deploy', 'target_reoptimized') GROUP BY api_sync_status`
          ),
          // 3. v513: 获取按操作类型的统计 — 排除内部系统事件
          dbInstance.execute(
            sql`SELECT action_type, api_sync_status, COUNT(*) as count 
            FROM optimization_events 
            WHERE ${accountFilter}
              AND action_type NOT IN ('settings_update', 'auto_correction', 'algorithm_config', 'strategy_update', 'system_config', 'system_deploy', 'target_reoptimized')
            GROUP BY action_type, api_sync_status 
            ORDER BY action_type, api_sync_status`
          ),
          // 4. 获取最近7天的纠错活动趋势
          dbInstance.execute(
            sql`SELECT DATE(api_synced_at) as date, COUNT(*) as corrections,
               SUM(CASE WHEN api_sync_status = 'synced' THEN 1 ELSE 0 END) as synced,
               SUM(CASE WHEN api_sync_status = 'failed' THEN 1 ELSE 0 END) as failed
            FROM optimization_events 
            WHERE ${accountFilter} AND api_synced_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY DATE(api_synced_at)
            ORDER BY date DESC`
          ),
          // 5. 获取待处理的关键词创建重试统计
          dbInstance.execute(
            sql`SELECT COUNT(*) as total,
               SUM(CASE WHEN action_detail LIKE '%code=ERROR%' THEN 1 ELSE 0 END) as retryable
            FROM optimization_events 
            WHERE ${accountFilter}
              AND action_type = 'keyword_create' 
              AND api_sync_status = 'not_applicable'
              AND keyword_id IS NULL`
          ),
          // 6. 获取否定关键词状态统计
          dbInstance.execute(
            sql`SELECT api_sync_status, COUNT(*) as count 
            FROM optimization_events 
            WHERE ${accountFilter} AND action_type = 'negative_keyword_add'
            GROUP BY api_sync_status`
          ),
          // 7. 获取最近的纠错活动日志（最近20条）
          dbInstance.execute(
            sql`SELECT id, action_type, api_sync_status, action_detail,
               COALESCE(api_sync_detail, '{}') as api_sync_detail,
               campaign_name, ad_group_name, keyword_text,
               created_at, api_synced_at
            FROM optimization_events
            WHERE ${accountFilter} AND api_sync_status IN ('synced', 'failed', 'permanently_failed')
            ORDER BY created_at DESC
            LIMIT 20`
          )
        ]);
        const result = {
          scanStatus,
          lastScan: lastScan ? {
            scanId: lastScan.scanId,
            startedAt: lastScan.startedAt,
            completedAt: lastScan.completedAt,
            accountsScanned: lastScan.accountsScanned,
            totalIssuesFound: lastScan.totalIssuesFound,
            totalCorrected: lastScan.totalCorrected,
            totalFailed: lastScan.totalFailed,
            details: lastScan.details
          } : null,
          config: config2,
          statusDistribution: statusStats || [],
          actionTypeBreakdown: actionStats || [],
          trendData: trendData || [],
          harvestRetryStats: harvestRetryStats?.[0] || { total: 0, retryable: 0 },
          negKeywordStats: negKeywordStats || [],
          recentCorrections: recentCorrections || []
        };
        apiCache.set(cacheKey, result, 60 * 1e3);
        apiCache.set(cacheKey + ":stale", result, 10 * 60 * 1e3);
        return result;
      }),
      // v204: 获取同步健康度报告
      getHealthReport: protectedProcedure.query(async () => {
        return getLatestHealthReport();
      })
    });
    autoRollbackRouter = router({
      // 获取所有回滚规则
      getRules: protectedProcedure.query(async () => {
        return getRollbackRules();
      }),
      // 获取单个回滚规则
      getRule: protectedProcedure.input(external_exports.object({ ruleId: external_exports.string() })).query(async ({ ctx, input }) => {
        return getRollbackRule(input.ruleId);
      }),
      // 创建回滚规则
      createRule: protectedProcedure.input(external_exports.object({
        name: external_exports.string(),
        description: external_exports.string(),
        // @ts-ignore
        enabled: external_exports.boolean(),
        conditions: external_exports.object({
          profitThresholdPercent: external_exports.number(),
          minTrackingDays: external_exports.union([external_exports.literal(7), external_exports.literal(14), external_exports.literal(30)]),
          minSampleCount: external_exports.number(),
          includeNegativeAdjustments: external_exports.boolean()
        }),
        actions: external_exports.object({
          autoRollback: external_exports.boolean(),
          sendNotification: external_exports.boolean(),
          notificationPriority: external_exports.enum(["low", "medium", "high"])
        })
      })).mutation(async ({ ctx, input }) => {
        return createRollbackRule(input);
      }),
      // 更新回滚规则
      updateRule: protectedProcedure.input(external_exports.object({
        ruleId: external_exports.string(),
        name: external_exports.string().optional(),
        // @ts-ignore
        description: external_exports.string().optional(),
        enabled: external_exports.boolean().optional(),
        conditions: external_exports.object({
          profitThresholdPercent: external_exports.number(),
          minTrackingDays: external_exports.union([external_exports.literal(7), external_exports.literal(14), external_exports.literal(30)]),
          minSampleCount: external_exports.number(),
          includeNegativeAdjustments: external_exports.boolean()
        }).optional(),
        // @ts-ignore
        actions: external_exports.object({
          autoRollback: external_exports.boolean(),
          sendNotification: external_exports.boolean(),
          notificationPriority: external_exports.enum(["low", "medium", "high"])
        }).optional()
      })).mutation(async ({ ctx, input }) => {
        const { ruleId, ...updates } = input;
        return updateRollbackRule(ruleId, updates);
      }),
      // 删除回滚规则
      deleteRule: protectedProcedure.input(external_exports.object({ ruleId: external_exports.string() })).mutation(async ({ ctx, input }) => {
        return deleteRollbackRule(input.ruleId);
      }),
      // 运行回滚评估
      runEvaluation: protectedProcedure.input(external_exports.object({ accountId: external_exports.number().optional() })).mutation(async ({ ctx, input }) => {
        return runRollbackEvaluation(input.accountId);
      }),
      // 获取回滚建议列表
      getSuggestions: protectedProcedure.input(external_exports.object({
        status: external_exports.enum(["pending", "approved", "rejected", "executed"]).optional(),
        priority: external_exports.enum(["low", "medium", "high"]).optional(),
        ruleId: external_exports.string().optional()
      })).query(async ({ ctx, input }) => {
        return getRollbackSuggestions(input);
      }),
      // 获取单个回滚建议
      getSuggestion: protectedProcedure.input(external_exports.object({ suggestionId: external_exports.string() })).query(async ({ ctx, input }) => {
        return getRollbackSuggestion(input.suggestionId);
      }),
      // 审核回滚建议
      reviewSuggestion: protectedProcedure.input(external_exports.object({
        suggestionId: external_exports.string(),
        action: external_exports.enum(["approve", "reject"]),
        reviewNote: external_exports.string().optional()
      })).mutation(async ({ input, ctx }) => {
        return reviewRollbackSuggestion(
          input.suggestionId,
          input.action,
          ctx.user.name || ctx.user.openId,
          input.reviewNote
        );
      }),
      // 执行回滚建议
      executeSuggestion: protectedProcedure.input(external_exports.object({ suggestionId: external_exports.string() })).mutation(async ({ ctx, input }) => {
        return executeRollbackSuggestion(input.suggestionId);
      }),
      // 获取回滚建议统计
      getStats: protectedProcedure.query(async () => {
        return getRollbackSuggestionStats();
      }),
      // 清理旧建议
      cleanup: protectedProcedure.mutation(async () => {
        return cleanupOldSuggestions();
      })
    });
    postDeployRouter = router({
      // 获取系统版本信息
      // v360: P3-2安全加固 - 版本信息可能泄露系统内部结构
      getVersionInfo: protectedProcedure.query(async () => {
        const { getSystemVersionInfo: getSystemVersionInfo2 } = await Promise.resolve().then(() => (init_postDeployOptimizer(), postDeployOptimizer_exports));
        return getSystemVersionInfo2();
      }),
      // 查询部署历史记录（从optimization_events中查询system_deploy事件）
      // v360: P3-2安全加固 - 部署历史可能泄露系统内部信息
      getDeployHistory: protectedProcedure.query(async () => {
        const { getDb: getDb3 } = await Promise.resolve().then(() => (init_db2(), db_exports));
        const { optimizationEvents: optimizationEvents9 } = await Promise.resolve().then(() => (init_schema2(), schema_exports));
        const { desc: desc29, and: and14, eq: eq12 } = await Promise.resolve().then(() => (init_drizzle_orm(), drizzle_orm_exports));
        const database = await getDb3();
        if (!database) return [];
        const events = await database.select().from(optimizationEvents9).where(
          and14(
            eq12(optimizationEvents9.eventCategory, "settings_change"),
            eq12(optimizationEvents9.actionType, "settings_update"),
            sql`JSON_EXTRACT(${optimizationEvents9.actionDetail}, '$.type') IN ('system_deploy', 'target_reoptimized')`
          )
          // @ts-ignore
        ).orderBy(desc29(optimizationEvents9.createdAt)).limit(50);
        return events.map((e) => ({
          id: e.id,
          type: e.actionDetail ? JSON.parse(e.actionDetail).type : "unknown",
          detail: e.actionDetail ? JSON.parse(e.actionDetail) : {},
          reason: e.changeReason,
          previousValue: e.previousValue,
          newValue: e.newValue,
          status: e.status,
          createdAt: e.createdAt
        }));
      }),
      // 手动触发重优化
      forceReoptimize: protectedProcedure.input(external_exports.object({
        modules: external_exports.array(external_exports.string()).optional(),
        targetId: external_exports.number().optional()
      })).mutation(async ({ ctx, input }) => {
        const { forceReoptimize: forceReoptimize2 } = await Promise.resolve().then(() => (init_postDeployOptimizer(), postDeployOptimizer_exports));
        return forceReoptimize2(input.modules, input.targetId);
      }),
      // 运行部署后重优化检查
      runCheck: protectedProcedure.mutation(async () => {
        const { runPostDeployOptimization: runPostDeployOptimization2 } = await Promise.resolve().then(() => (init_postDeployOptimizer(), postDeployOptimizer_exports));
        return runPostDeployOptimization2();
      })
    });
  }
});

