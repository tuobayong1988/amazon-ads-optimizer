/**
 * 纠错与回滚路由
 * 从 routers.ts 拆分的独立路由模块
 */
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import * as db from "../db";
import * as correctionService from '../automation/correctionService';
import * as autoRollbackService from '../automation/autoRollbackService';
import { runAutoCorrection, getScanHistory, getLastScanResult, getScanStatus, getConfig as getAutoCorrectorConfig, getLatestHealthReport } from '../optimization/optimizationAutoCorrector';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import { apiCache } from '../services/apiCacheService';


// ==================== Correction Review Router ====================
export const correctionRouter = router({
  // List correction review sessions
  listSessions: protectedProcedure
    .input(z.object({
      accountId: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return db.listCorrectionReviewSessions(ctx.user.id, input.accountId);
    }),

  // v370.4: 数据隔离 - Get correction review session details
  getSession: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }: any) => {
      const session = await db.getCorrectionReviewSession(input.id);
      if (!session) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' });
      }
      // v370.4: 验证session归属当前用户
      if (session.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }
      return session;
    }),

  // Create new correction review session
  createSession: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      periodDays: z.number().optional().default(14),
    }))
    .mutation(async ({ ctx, input }) => {
      const periodEnd = new Date();
      periodEnd.setDate(periodEnd.getDate() - correctionService.MIN_ANALYSIS_DELAY_DAYS);
      
      const periodStart = new Date(periodEnd);
      periodStart.setDate(periodStart.getDate() - input.periodDays);

      const sessionId = await db.createCorrectionReviewSession({
        userId: ctx.user.id,
        accountId: input.accountId,
        periodStart,
        periodEnd,
      });

      return { sessionId, periodStart, periodEnd };
    }),

  // Analyze bid adjustments for a session
  analyzeSession: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const session = await db.getCorrectionReviewSession(input.sessionId);
      if (!session) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' });
      }

      // Get bid change records for the period
      const bidChanges = await db.getBidChangeRecords(session.accountId, 30);
      
      // Filter to the session period
      const periodBidChanges = bidChanges.filter(change => {
        const changeDate = new Date(change.changeDate);
        const periodStart = new Date(session.periodStart);
        const periodEnd = new Date(session.periodEnd);
        return changeDate >= periodStart && changeDate <= periodEnd;
      });

      const corrections: correctionService.CorrectionAnalysis[] = [];

      for (const change of periodBidChanges) {
        // Get metrics after attribution window (simulated)
        const metricsAfterAttribution: correctionService.PerformanceMetrics = {
          impressions: Math.floor(Math.random() * 1000),
          clicks: Math.floor(Math.random() * 50),
          spend: Math.random() * 100,
          sales: Math.random() * 500,
          orders: Math.floor(Math.random() * 10),
          acos: Math.random() * 50,
          roas: Math.random() * 5,
          ctr: Math.random() * 5,
          cvr: Math.random() * 10,
        };

        const metricsAtAdjustment: correctionService.PerformanceMetrics = {
          impressions: Math.floor(Math.random() * 1000),
          clicks: Math.floor(Math.random() * 50),
          spend: change.performanceAfter?.spend || 0,
          sales: change.performanceAfter?.sales || 0,
          orders: change.performanceAfter?.conversions || 0,
          acos: change.performanceAfter?.acos || 0,
          roas: change.performanceAfter?.roas || 0,
          ctr: Math.random() * 5,
          cvr: Math.random() * 10,
        };

        const record: correctionService.BidAdjustmentRecord = {
          id: change.id,
          targetId: change.targetId,
          targetName: change.targetName,
          targetType: change.targetType === 'placement' ? 'keyword' : change.targetType,
          campaignId: change.campaignId,
          campaignName: change.campaignName,
          originalBid: change.oldBid,
          adjustedBid: change.newBid,
          adjustmentDate: new Date(change.changeDate),
          adjustmentReason: change.changeReason,
          metricsAtAdjustment,
        };

        const analysis = correctionService.analyzeBidAdjustment(record, metricsAfterAttribution);
        corrections.push(analysis);

        // Save correction record to database
        await db.addAttributionCorrectionRecord({
          userId: ctx.user.id,
          accountId: session.accountId,
          biddingLogId: change.id,
          campaignId: change.campaignId,
          targetType: record.targetType,
          targetId: change.targetId,
          targetName: change.targetName,
          originalAdjustmentDate: change.changeDate,
          originalBid: change.oldBid,
          adjustedBid: change.newBid,
          adjustmentReason: change.changeReason,
          metricsAtAdjustment: metricsAtAdjustment as unknown as Record<string, any>,
          metricsAfterAttribution: metricsAfterAttribution as unknown as Record<string, any>,
          wasIncorrect: analysis.wasIncorrect,
          correctionType: analysis.correctionType,
          suggestedBid: analysis.suggestedBid,
          confidenceScore: analysis.confidenceScore,
        });
      }

      // Generate report
      const report = correctionService.generateCorrectionReport(
        input.sessionId,
        session.periodStart,
        session.periodEnd,
        corrections
      );

      // Update session with results
      await db.updateCorrectionReviewSession(input.sessionId, {
        status: 'ready_for_review',
        totalAdjustmentsReviewed: report.totalAdjustmentsReviewed,
        incorrectAdjustments: report.incorrectAdjustments,
        overDecreasedCount: report.overDecreasedCount,
        overIncreasedCount: report.overIncreasedCount,
        correctCount: report.correctCount,
        estimatedLostRevenue: report.estimatedLostRevenue,
        estimatedWastedSpend: report.estimatedWastedSpend,
        potentialRecovery: report.potentialRecovery,
      });

      return report;
    }),

  // v370.4: 数据隔离 - Get correction records for a session
  getCorrections: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }: any) => {
      const session = await db.getCorrectionReviewSession(input.sessionId);
      if (!session || session.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }
      return db.getCorrectionRecordsForSession(input.sessionId);
    }),

  // v370.4: 数据隔离 - Apply corrections as batch operation
  applyCorrections: protectedProcedure
    .input(z.object({
      sessionId: z.number(),
      correctionIds: z.array(z.number()),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await db.getCorrectionReviewSession(input.sessionId);
      if (!session) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' });
      }
      // v370.4: 数据隔离
      if (session.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }

      // Get correction records
      const corrections = await db.getCorrectionRecordsForSession(input.sessionId);
      const selectedCorrections = corrections.filter(c => input.correctionIds.includes(c.id));

      if (selectedCorrections.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No corrections selected' });
      }

      // Create batch operation for corrections
      const batchId = await db.createBatchOperation({
        userId: ctx.user.id,
        accountId: session.accountId,
        operationType: 'bid_adjustment',
        name: `纠错复盘 - ${new Date().toLocaleDateString()}`,
        description: `基于半月纠错复盘分析的出价纠正`,
        requiresApproval: true,
        sourceType: 'correction_review',
        sourceTaskId: input.sessionId,
      });

      // Add items
      const items = selectedCorrections.map(c => ({
        entityType: c.correctionTargetType as 'keyword' | 'product_target',
        entityId: c.targetId,
        entityName: c.targetName || undefined,
        currentBid: parseFloat(c.adjustedBid || '0'),
        newBid: parseFloat(c.suggestedBid || '0'),
        bidChangeReason: `纠错复盘: ${correctionService.formatCorrectionType(c.correctionType as 'over_decreased' | 'over_increased' | 'correct')}`,
      }));

      await db.addBatchOperationItems(batchId, items);

      // Update session
      await db.updateCorrectionReviewSession(input.sessionId, {
        status: 'corrections_applied',
        reviewedAt: new Date(),
        reviewedBy: ctx.user.id,
        correctionBatchId: batchId,
      });

      // Update correction record statuses
      for (const id of input.correctionIds) {
        await db.updateAttributionCorrectionStatus(id, {
          status: 'approved',
        });
      }

      return { batchId, itemCount: items.length };
    }),

  // Dismiss corrections
  dismissCorrections: protectedProcedure
    .input(z.object({
      correctionIds: z.array(z.number()),
    }))
    .mutation(async ({ ctx, input }: any) => {
      for (const id of input.correctionIds) {
        await db.updateAttributionCorrectionStatus(id, {
          status: 'dismissed',
        });
      }
      return { success: true };
    }),

  // v370.4: 数据隔离 - Get recommendations
  getRecommendations: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ ctx, input }: any) => {
      const session = await db.getCorrectionReviewSession(input.sessionId);
      if (!session || session.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }
      const corrections = await db.getCorrectionRecordsForSession(input.sessionId);
      
      // Convert to CorrectionAnalysis format for recommendations
      // @ts-ignore
      const analyses: correctionService.CorrectionAnalysis[] = corrections.map(c => ({
        record: {
          id: c.id,
          targetId: c.targetId,
          targetName: c.targetName || '',
          targetType: c.correctionTargetType as 'keyword' | 'product_target',
          campaignId: c.campaignId,
          campaignName: '',
          originalBid: parseFloat(c.originalBid || '0'),
          adjustedBid: parseFloat(c.adjustedBid || '0'),
          adjustmentDate: new Date(c.originalAdjustmentDate),
          adjustmentReason: c.adjustmentReason || '',
          metricsAtAdjustment: JSON.parse(c.metricsAtAdjustment || '{}'),
        },
        metricsAfterAttribution: JSON.parse(c.metricsAfterAttribution || '{}'),
        wasIncorrect: !!c.wasIncorrect,
        correctionType: (c.correctionType || 'correct') as 'over_decreased' | 'over_increased' | 'correct',
        suggestedBid: parseFloat(c.suggestedBid || '0'),
        confidenceScore: parseFloat(c.confidenceScore || '0'),
        impactAnalysis: {
          estimatedLostRevenue: 0,
          estimatedWastedSpend: 0,
          potentialRecovery: 0,
        },
        explanation: '',
      } as Record<string, any>));

      return correctionService.generateRecommendations(analyses);
    }),
});


export const autoCorrectionRouter = router({
  // 运行自动纠错扫描
  runScan: protectedProcedure
    .input(z.object({ accountId: z.number().optional() }))
    .mutation(async ({ ctx, input }: any) => {
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
    return getAutoCorrectorConfig();
  }),
  
  // v177: 监控仪表盘 - 获取全面的纠错状态概览
  // v364: 修复多租户数据泄露 - 添加account_id过滤和缓存隔离
  getDashboard: protectedProcedure.query(async ({ ctx }) => {
    // v399: 获取当前用户关联的账户ID列表用于数据隔离
    const dbInstance = await db.getDb();
    if (!dbInstance) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '数据库连接失败' });
    
    const isAdmin = ctx.user.role === 'admin';
    
    // v399: admin用户可以查看所有账户数据，普通用户只能看自己的
    let accountIds: number[] = [];
    if (!isAdmin) {
      const userAccounts = await dbInstance.execute(
        sql`SELECT id FROM ad_accounts WHERE userId = ${ctx.user.id}`
      ) as any;
      accountIds = (userAccounts?.[0] || []).map((a: any) => a.id);
    }
    
    // v399: 缓存按用户隔离，避免跨租户数据泄露
    const cacheKey = `correction.getDashboard:user:${ctx.user.id}`;
    const cached = apiCache.get<any>(cacheKey);
    if (cached) return cached;
    
    // v399: admin用户不加过滤条件，普通用户按accountId过滤
    const accountFilter = isAdmin 
      ? sql`1=1`
      : (accountIds.length > 0 
        ? sql`account_id IN (${sql.join(accountIds.map((id: number) => sql`${id}`), sql`, `)})` 
        : sql`1=0`);
    
    // 1. 获取最近扫描状态
    const scanStatus = getScanStatus();
    const lastScan = getLastScanResult();
    const config = getAutoCorrectorConfig();
    
    // v390: 将串6个串行SQL查询改为Promise.all并行执行，大幅提升响应速度
    const [
      [statusStats],
      [actionStats],
      [trendData],
      [harvestRetryStats],
      [negKeywordStats],
      [recentCorrections],
    ] = await Promise.all([
      // 2. 获取事件状态统计
      dbInstance.execute(
        sql`SELECT api_sync_status, COUNT(*) as count FROM optimization_events WHERE ${accountFilter} GROUP BY api_sync_status`
      ) as any,
      // 3. 获取按操作类型的统计
      dbInstance.execute(
        sql`SELECT action_type, api_sync_status, COUNT(*) as count 
            FROM optimization_events 
            WHERE ${accountFilter}
            GROUP BY action_type, api_sync_status 
            ORDER BY action_type, api_sync_status`
      ) as any,
      // 4. 获取最近7天的纠错活动趋势
      dbInstance.execute(
        sql`SELECT DATE(api_synced_at) as date, COUNT(*) as corrections,
               SUM(CASE WHEN api_sync_status = 'synced' THEN 1 ELSE 0 END) as synced,
               SUM(CASE WHEN api_sync_status IN ('failed', 'not_applicable', 'invalid_legacy') THEN 1 ELSE 0 END) as failed
            FROM optimization_events 
            WHERE ${accountFilter} AND api_synced_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY DATE(api_synced_at)
            ORDER BY date DESC`
      ) as any,
      // 5. 获取待处理的关键词创建重试统计
      dbInstance.execute(
        sql`SELECT COUNT(*) as total,
               SUM(CASE WHEN action_detail LIKE '%code=ERROR%' THEN 1 ELSE 0 END) as retryable
            FROM optimization_events 
            WHERE ${accountFilter}
              AND action_type = 'keyword_create' 
              AND api_sync_status = 'not_applicable'
              AND keyword_id IS NULL`
      ) as any,
      // 6. 获取否定关键词状态统计
      dbInstance.execute(
        sql`SELECT api_sync_status, COUNT(*) as count 
            FROM optimization_events 
            WHERE ${accountFilter} AND action_type = 'negative_keyword_add'
            GROUP BY api_sync_status`
      ) as any,
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
      ) as any,
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
        details: lastScan.details,
      } : null,
      config,
      statusDistribution: statusStats || [],
      actionTypeBreakdown: actionStats || [],
      trendData: trendData || [],
      harvestRetryStats: harvestRetryStats?.[0] || { total: 0, retryable: 0 },
      negKeywordStats: negKeywordStats || [],
      recentCorrections: recentCorrections || [],
    };
    // v268: 缓存结果
    apiCache.set(cacheKey, result, 60 * 1000);
    return result;
  }),
  
  // v204: 获取同步健康度报告
  getHealthReport: protectedProcedure.query(async () => {
    return getLatestHealthReport();
  }),
});


// ==================== Auto Rollback Router ====================
export const autoRollbackRouter = router({
  // 获取所有回滚规则
  getRules: protectedProcedure.query(async () => {
    return autoRollbackService.getRollbackRules();
  }),
  
  // 获取单个回滚规则
  getRule: protectedProcedure
    .input(z.object({ ruleId: z.string() }))
    .query(async ({ ctx, input }: any) => {
      return autoRollbackService.getRollbackRule(input.ruleId);
    }),
  
  // 创建回滚规则
  createRule: protectedProcedure
    .input(z.object({
      name: z.string(),
      description: z.string(),
      enabled: z.boolean(),
      conditions: z.object({
        profitThresholdPercent: z.number(),
        minTrackingDays: z.union([z.literal(7), z.literal(14), z.literal(30)]),
        minSampleCount: z.number(),
        includeNegativeAdjustments: z.boolean()
      }),
      actions: z.object({
        autoRollback: z.boolean(),
        sendNotification: z.boolean(),
        notificationPriority: z.enum(['low', 'medium', 'high'])
      })
    }))
    .mutation(async ({ ctx, input }: any) => {
      return autoRollbackService.createRollbackRule(input);
    }),
  
  // 更新回滚规则
  updateRule: protectedProcedure
    .input(z.object({
      ruleId: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      enabled: z.boolean().optional(),
      conditions: z.object({
        profitThresholdPercent: z.number(),
        minTrackingDays: z.union([z.literal(7), z.literal(14), z.literal(30)]),
        minSampleCount: z.number(),
        includeNegativeAdjustments: z.boolean()
      }).optional(),
      actions: z.object({
        autoRollback: z.boolean(),
        sendNotification: z.boolean(),
        notificationPriority: z.enum(['low', 'medium', 'high'])
      }).optional()
    }))
    .mutation(async ({ ctx, input }: any) => {
      const { ruleId, ...updates } = input;
      return autoRollbackService.updateRollbackRule(ruleId, updates);
    }),
  
  // 删除回滚规则
  deleteRule: protectedProcedure
    .input(z.object({ ruleId: z.string() }))
    .mutation(async ({ ctx, input }: any) => {
      return autoRollbackService.deleteRollbackRule(input.ruleId);
    }),
  
  // 运行回滚评估
  runEvaluation: protectedProcedure
    .input(z.object({ accountId: z.number().optional() }))
    .mutation(async ({ ctx, input }: any) => {
      return autoRollbackService.runRollbackEvaluation(input.accountId);
    }),
  
  // 获取回滚建议列表
  getSuggestions: protectedProcedure
    .input(z.object({
      status: z.enum(['pending', 'approved', 'rejected', 'executed']).optional(),
      priority: z.enum(['low', 'medium', 'high']).optional(),
      ruleId: z.string().optional()
    }))
    .query(async ({ ctx, input }: any) => {
      return autoRollbackService.getRollbackSuggestions(input);
    }),
  
  // 获取单个回滚建议
  getSuggestion: protectedProcedure
    .input(z.object({ suggestionId: z.string() }))
    .query(async ({ ctx, input }: any) => {
      return autoRollbackService.getRollbackSuggestion(input.suggestionId);
    }),
  
  // 审核回滚建议
  reviewSuggestion: protectedProcedure
    .input(z.object({
      suggestionId: z.string(),
      action: z.enum(['approve', 'reject']),
      reviewNote: z.string().optional()
    }))
    .mutation(async ({ input, ctx }: any) => {
      return autoRollbackService.reviewRollbackSuggestion(
        input.suggestionId,
        input.action,
        ctx.user.name || ctx.user.openId,
        input.reviewNote
      );
    }),
  
  // 执行回滚建议
  executeSuggestion: protectedProcedure
    .input(z.object({ suggestionId: z.string() }))
    .mutation(async ({ ctx, input }: any) => {
      return autoRollbackService.executeRollbackSuggestion(input.suggestionId);
    }),
  
  // 获取回滚建议统计
  getStats: protectedProcedure.query(async () => {
    return autoRollbackService.getRollbackSuggestionStats();
  }),
  
  // 清理旧建议
  cleanup: protectedProcedure.mutation(async () => {
    return autoRollbackService.cleanupOldSuggestions();
  }),
});


// ==================== Auto Correction Router (v167) ====================
// ==================== v184: 部署后自动重优化路由 ====================
export const postDeployRouter = router({
  // 获取系统版本信息
  // v360: P3-2安全加固 - 版本信息可能泄露系统内部结构
  getVersionInfo: protectedProcedure.query(async () => {
    const { getSystemVersionInfo } = await import('../postDeployOptimizer');
    return getSystemVersionInfo();
  }),
  
  // 查询部署历史记录（从optimization_events中查询system_deploy事件）
  // v360: P3-2安全加固 - 部署历史可能泄露系统内部信息
  getDeployHistory: protectedProcedure.query(async () => {
    const { getDb } = await import('../db');
    const { optimizationEvents } = await import('../../drizzle/schema');
    const { desc, and, eq } = await import('drizzle-orm');
    const database = await getDb();
    if (!database) return [];
    const events = await database
      .select()
      .from(optimizationEvents)
      .where(
        and(
          eq(optimizationEvents.eventCategory, 'settings_change'),
          eq(optimizationEvents.actionType, 'settings_update'),
          sql`JSON_EXTRACT(${optimizationEvents.actionDetail}, '$.type') IN ('system_deploy', 'target_reoptimized')`
        )
      )
      .orderBy(desc(optimizationEvents.createdAt))
      .limit(50);
    return events.map(e => ({
      id: e.id,
      type: e.actionDetail ? JSON.parse(e.actionDetail).type : 'unknown',
      detail: e.actionDetail ? JSON.parse(e.actionDetail) : {},
      reason: e.changeReason,
      previousValue: e.previousValue,
      newValue: e.newValue,
      status: e.status,
      createdAt: e.createdAt,
    }));
  }),
  
  // 手动触发重优化
  forceReoptimize: protectedProcedure
    .input(z.object({
      modules: z.array(z.string()).optional(),
      targetId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }: any) => {
      const { forceReoptimize } = await import('../postDeployOptimizer');
      return forceReoptimize(input.modules, input.targetId);
    }),
  
  // 运行部署后重优化检查
  runCheck: protectedProcedure.mutation(async () => {
    const { runPostDeployOptimization } = await import('../postDeployOptimizer');
    return runPostDeployOptimization();
  }),
});
