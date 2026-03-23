/**
 * 数据概览智能建议 tRPC 路由 v501
 * 
 * 提供三类建议的扫描查询和一键优化执行接口：
 * 1. scan - 扫描全部三类建议
 * 2. executeEmergencyBleeding - 执行紧急止血
 * 3. executeHighAcosSuppression - 执行高ACOS抑制
 * 4. executeGoalAdjustment - 执行优化目标调整
 * 5. diagnostics - 诊断优化引擎真实数据（临时）
 */
import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import {
  scanDashboardRecommendations,
  executeEmergencyBleeding,
  executeHighAcosSuppression,
  executeGoalAdjustment,
} from '../analytics/dashboardRecommendationEngine';
import { verifyAccountAccess } from '../utils/accessControl';
import { createModuleLogger } from '../utils/logger';
import { getDb } from '../db';
import { sql } from 'drizzle-orm';

const log = createModuleLogger('Route_dashboardRecommendation');

async function safeQuery(db_: any, label: string, query: any) {
  try {
    const result = await db_.execute(query);
    return { success: true, data: (result as unknown[][])[0] || [] };
  } catch (err: unknown) {
    return { success: false, error: `[${label}] ${(err as Error).message}` };
  }
}

export const dashboardRecommendationRouter = router({
  /**
   * 扫描数据概览三类建议
   */
  scan: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      return await scanDashboardRecommendations(input.accountId);
    }),

  /**
   * 执行紧急止血 - 添加否定词或降低零转化投放竞价
   */
  executeEmergencyBleeding: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      itemIds: z.array(z.string()),
      items: z.array(z.object({
        id: z.string(),
        entityType: z.enum(['search_term', 'product_target']),
        entityId: z.number(),
        amazonEntityId: z.string(),
        entityText: z.string(),
        campaignId: z.string(),
        campaignName: z.string(),
        campaignDbId: z.number(),
        adGroupId: z.number(),
        adGroupName: z.string(),
        spend: z.number(),
        clicks: z.number(),
        impressions: z.number(),
        orders: z.number(),
        currentBid: z.number(),
        suggestedAction: z.enum(['add_negative_exact', 'reduce_bid_90']),
        actionLabel: z.string(),
      })),
    }))
    .mutation(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      log.info(`[紧急止血] 用户 #${ctx.user.id} 执行 ${input.itemIds.length} 项优化`);
      return await executeEmergencyBleeding(input.accountId, input.itemIds, input.items);
    }),

  /**
   * 执行高ACOS抑制 - 降低高ACOS关键词和商品投放的竞价
   */
  executeHighAcosSuppression: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      itemIds: z.array(z.string()),
      items: z.array(z.object({
        id: z.string(),
        entityType: z.enum(['keyword', 'product_target']),
        entityId: z.number(),
        amazonEntityId: z.string(),
        entityText: z.string(),
        matchType: z.string(),
        campaignId: z.string(),
        campaignName: z.string(),
        campaignDbId: z.number(),
        adGroupId: z.number(),
        adGroupName: z.string(),
        spend: z.number(),
        sales: z.number(),
        orders: z.number(),
        acos: z.number(),
        currentBid: z.number(),
        suggestedBid: z.number(),
        reductionPercent: z.number(),
        suggestedAction: z.enum(['reduce_bid']),
        actionLabel: z.string(),
      })),
    }))
    .mutation(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      log.info(`[高ACOS抑制] 用户 #${ctx.user.id} 执行 ${input.itemIds.length} 项优化`);
      return await executeHighAcosSuppression(input.accountId, input.itemIds, input.items);
    }),

  /**
   * 诊断端点 - 查询优化引擎真实数据（每个查询独立try-catch）
   */
  diagnostics: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      const db_ = await getDb();
      if (!db_) return { error: 'DB connection failed' };
      
      const acctId = input.accountId;
      
      // 1. optimization_events表中30天bid_adjustment记录数和状态分布
      const q1 = await safeQuery(db_, 'events_count', sql`
        SELECT COUNT(*) as total,
          SUM(CASE WHEN api_sync_status = 'synced' THEN 1 ELSE 0 END) as synced,
          SUM(CASE WHEN api_sync_status = 'failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN api_sync_status = 'pending' THEN 1 ELSE 0 END) as pending_count,
          SUM(CASE WHEN api_sync_status = 'not_applicable' THEN 1 ELSE 0 END) as not_applicable
        FROM optimization_events 
        WHERE event_category = 'bid_adjustment' 
          AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          AND account_id = ${acctId}
      `);
      
      // 2. optimization_logs表中30天bid_adjustment记录数
      const q2 = await safeQuery(db_, 'logs_count', sql`
        SELECT COUNT(*) as total,
          SUM(CASE WHEN api_sync_status = 'synced' THEN 1 ELSE 0 END) as synced,
          SUM(CASE WHEN api_sync_status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM optimization_logs 
        WHERE log_category = 'bid_adjustment' 
          AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
          AND account_id = ${acctId}
      `);
      
      // 3. 所有账户的optimization_events总数（不按account_id过滤）
      const q3 = await safeQuery(db_, 'all_events', sql`
        SELECT COUNT(*) as total,
          SUM(CASE WHEN api_sync_status = 'synced' THEN 1 ELSE 0 END) as synced,
          SUM(CASE WHEN api_sync_status = 'failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN api_sync_status = 'not_applicable' THEN 1 ELSE 0 END) as not_applicable
        FROM optimization_events 
        WHERE event_category = 'bid_adjustment' 
          AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      `);
      
      // 4. optimization_tasks表中的任务状态（不按account_id过滤）
      const q4 = await safeQuery(db_, 'tasks_status', sql`
        SELECT status, task_type, COUNT(*) as cnt
        FROM optimization_tasks
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        GROUP BY status, task_type
        ORDER BY cnt DESC
        LIMIT 30
      `);
      
      // 5. 最近10条bid_adjustment事件的详情（不按account_id过滤）
      const q5 = await safeQuery(db_, 'recent_events', sql`
        SELECT id, account_id, action_type, api_sync_status, change_reason, 
          previous_bid, new_bid, created_at
        FROM optimization_events 
        WHERE event_category = 'bid_adjustment'
        ORDER BY created_at DESC LIMIT 10
      `);
      
      // 6. 各campaign_type的关键词数量（当前账户）
      const q6 = await safeQuery(db_, 'campaign_type_keywords', sql`
        SELECT c.campaign_type, k.keyword_status, COUNT(*) as cnt
        FROM keywords k
        JOIN campaigns c ON k.campaign_id = c.campaign_id
        WHERE c.account_id = ${acctId}
        GROUP BY c.campaign_type, k.keyword_status
        ORDER BY c.campaign_type, k.keyword_status
      `);
      
      // 7. 最近7天每天的优化事件数量（所有账户）
      const q7 = await safeQuery(db_, 'daily_events', sql`
        SELECT DATE(created_at) as event_date, COUNT(*) as cnt, 
          SUM(CASE WHEN api_sync_status = 'synced' THEN 1 ELSE 0 END) as synced,
          SUM(CASE WHEN api_sync_status = 'not_applicable' THEN 1 ELSE 0 END) as not_applicable
        FROM optimization_events 
        WHERE event_category = 'bid_adjustment' 
          AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        GROUP BY DATE(created_at)
        ORDER BY event_date DESC
      `);
      
      // 8. optimization_events中所有event_category的分布
      const q8 = await safeQuery(db_, 'event_categories', sql`
        SELECT event_category, COUNT(*) as cnt
        FROM optimization_events 
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY event_category
        ORDER BY cnt DESC
      `);
      
      // 9. 检查SB广告活动数量
      const q9 = await safeQuery(db_, 'sb_campaigns', sql`
        SELECT campaign_type, COUNT(*) as cnt, 
          SUM(CASE WHEN campaign_status = 'enabled' THEN 1 ELSE 0 END) as enabled_cnt
        FROM campaigns 
        WHERE account_id = ${acctId}
        GROUP BY campaign_type
      `);
      
      // 10. 检查optimization_events中算法分布
      const q10 = await safeQuery(db_, 'algorithm_distribution', sql`
        SELECT algorithm_used, COUNT(*) as cnt,
          SUM(CASE WHEN api_sync_status = 'synced' THEN 1 ELSE 0 END) as synced,
          SUM(CASE WHEN api_sync_status = 'not_applicable' THEN 1 ELSE 0 END) as not_applicable
        FROM optimization_events 
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY algorithm_used
        ORDER BY cnt DESC
        LIMIT 20
      `);
      
      // 11. 按campaign_type分组的optimization_events（检查SB广告是否被优化）
      const q11 = await safeQuery(db_, 'events_by_campaign_type', sql`
        SELECT c.campaign_type, oe.api_sync_status, COUNT(*) as cnt
        FROM optimization_events oe
        JOIN campaigns c ON oe.campaign_id = c.id
        WHERE oe.account_id = ${acctId}
          AND oe.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY c.campaign_type, oe.api_sync_status
        ORDER BY c.campaign_type, cnt DESC
      `);
      
      // 12. 检查permanently_failed的bid_adjustment任务详情
      const q12 = await safeQuery(db_, 'failed_tasks_detail', sql`
        SELECT ot.task_type, ot.status, ot.error_message, ot.entity_type, COUNT(*) as cnt
        FROM optimization_tasks ot
        WHERE ot.status IN ('permanently_failed', 'failed')
          AND ot.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        GROUP BY ot.task_type, ot.status, ot.error_message, ot.entity_type
        ORDER BY cnt DESC
        LIMIT 20
      `);
      
      // 13. 检查优化目标(performance_groups)状态
      const q13 = await safeQuery(db_, 'optimization_targets', sql`
        SELECT pg.id, pg.name, pg.status, pg.target_acos,
          (SELECT COUNT(*) FROM campaigns c WHERE c.performance_group_id = pg.id) as campaign_count,
          (SELECT COUNT(*) FROM campaigns c WHERE c.performance_group_id = pg.id AND c.campaign_type = 'sponsoredBrands') as sb_campaign_count
        FROM performance_groups pg
        WHERE pg.account_id = ${acctId}
        ORDER BY pg.id
      `);
      
      // 14. 检查SB广告活动的关键词是否有竞价调整记录
      const q14 = await safeQuery(db_, 'sb_bid_events', sql`
        SELECT oe.api_sync_status, oe.change_reason, oe.previous_bid, oe.new_bid, oe.created_at,
          c.campaign_name, c.campaign_type
        FROM optimization_events oe
        JOIN campaigns c ON oe.campaign_id = c.id
        WHERE oe.account_id = ${acctId}
          AND c.campaign_type = 'sponsoredBrands'
          AND oe.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        ORDER BY oe.created_at DESC
        LIMIT 10
      `);
      
      // 15. 检查算法效果概览的实际数据（模拟前端查询）
      const q15 = await safeQuery(db_, 'algorithm_effect_real', sql`
        SELECT COUNT(*) as total_events,
          COUNT(DISTINCT DATE(created_at)) as active_days,
          MIN(created_at) as earliest,
          MAX(created_at) as latest
        FROM optimization_events
        WHERE account_id = ${acctId}
          AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      `);
      
      return {
        q1_events_30d: q1,
        q2_logs_30d: q2,
        q3_all_events_30d: q3,
        q4_tasks_7d: q4,
        q5_recent_events: q5,
        q6_campaign_type_keywords: q6,
        q7_daily_events: q7,
        q8_event_categories: q8,
        q9_campaign_types: q9,
        q10_algorithm_distribution: q10,
        q11_events_by_campaign_type: q11,
        q12_failed_tasks_detail: q12,
        q13_optimization_targets: q13,
        q14_sb_bid_events: q14,
        q15_algorithm_effect_real: q15,
      };
    }),

  /**
   * 执行优化目标调整 - 将广告活动分配到绩效组
   */
  executeGoalAdjustment: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      campaignDbIds: z.array(z.number()),
      performanceGroupId: z.number(),
    }))
    .mutation(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      log.info(`[优化目标调整] 用户 #${ctx.user.id} 将 ${input.campaignDbIds.length} 个广告活动分配到绩效组 #${input.performanceGroupId}`);
      return await executeGoalAdjustment(input.accountId, input.campaignDbIds, input.performanceGroupId);
    }),
});
