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
   * 诊断端点 - 查询优化引擎真实数据
   */
  diagnostics: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .query(async ({ input, ctx }: unknown) => {
      await verifyAccountAccess(ctx.user.id, input.accountId);
      const db_ = await getDb();
      if (!db_) return { error: 'DB connection failed' };
      
      try {
        // 1. optimization_events表中30天bid_adjustment记录数和状态分布
        const eventsCount = await db_.execute(sql`
          SELECT COUNT(*) as total,
            SUM(CASE WHEN api_sync_status = 'synced' THEN 1 ELSE 0 END) as synced,
            SUM(CASE WHEN api_sync_status = 'failed' THEN 1 ELSE 0 END) as failed,
            SUM(CASE WHEN api_sync_status = 'pending' THEN 1 ELSE 0 END) as pending_count,
            SUM(CASE WHEN api_sync_status = 'not_applicable' THEN 1 ELSE 0 END) as not_applicable
          FROM optimization_events 
          WHERE event_category = 'bid_adjustment' 
            AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            AND account_id = ${input.accountId}
        `);
        
        // 2. optimization_logs表中30天bid_adjustment记录数
        const logsCount = await db_.execute(sql`
          SELECT COUNT(*) as total,
            SUM(CASE WHEN api_sync_status = 'synced' THEN 1 ELSE 0 END) as synced,
            SUM(CASE WHEN api_sync_status = 'failed' THEN 1 ELSE 0 END) as failed
          FROM optimization_logs 
          WHERE log_category = 'bid_adjustment' 
            AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            AND account_id = ${input.accountId}
        `);
        
        // 3. amazon_deleted关键词数量
        const deletedKeywords = await db_.execute(sql`
          SELECT COUNT(*) as total FROM keywords 
          WHERE keyword_status = 'amazon_deleted'
            AND campaign_id IN (SELECT campaign_id FROM campaigns WHERE account_id = ${input.accountId})
        `);
        
        // 4. SB广告活动的关键词状态分布
        const sbKeywordStatus = await db_.execute(sql`
          SELECT k.keyword_status, COUNT(*) as cnt
          FROM keywords k
          JOIN campaigns c ON k.campaign_id = c.campaign_id
          WHERE c.account_id = ${input.accountId}
            AND (c.campaign_type LIKE '%sb%' OR c.campaign_type LIKE '%brand%')
          GROUP BY k.keyword_status
        `);
        
        // 5. optimization_tasks表中的任务状态
        const tasksStatus = await db_.execute(sql`
          SELECT status, task_type, COUNT(*) as cnt
          FROM optimization_tasks
          WHERE account_id = ${input.accountId}
            AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
          GROUP BY status, task_type
        `);
        
        // 6. 最近10条bid_adjustment事件的详情
        const recentEvents = await db_.execute(sql`
          SELECT id, action_type, api_sync_status, change_reason, previous_bid, new_bid, created_at
          FROM optimization_events 
          WHERE event_category = 'bid_adjustment' 
            AND account_id = ${input.accountId}
          ORDER BY created_at DESC LIMIT 10
        `);
        
        // 7. SB广告活动数量和关键词总数
        const sbCampaignStats = await db_.execute(sql`
          SELECT 
            COUNT(DISTINCT c.id) as sb_campaigns,
            (SELECT COUNT(*) FROM keywords k2 JOIN campaigns c2 ON k2.campaign_id = c2.campaign_id 
             WHERE c2.account_id = ${input.accountId} AND (c2.campaign_type LIKE '%sb%' OR c2.campaign_type LIKE '%brand%') AND k2.keyword_status = 'enabled') as sb_enabled_keywords,
            (SELECT COUNT(*) FROM keywords k3 JOIN campaigns c3 ON k3.campaign_id = c3.campaign_id 
             WHERE c3.account_id = ${input.accountId} AND (c3.campaign_type LIKE '%sb%' OR c3.campaign_type LIKE '%brand%') AND k3.keyword_status = 'amazon_deleted') as sb_deleted_keywords
          FROM campaigns c
          WHERE c.account_id = ${input.accountId}
            AND (c.campaign_type LIKE '%sb%' OR c.campaign_type LIKE '%brand%')
        `);
        
        // 8. 各campaign类型的关键词数量
        const campaignTypeKeywords = await db_.execute(sql`
          SELECT c.campaign_type, k.keyword_status, COUNT(*) as cnt
          FROM keywords k
          JOIN campaigns c ON k.campaign_id = c.campaign_id
          WHERE c.account_id = ${input.accountId}
          GROUP BY c.campaign_type, k.keyword_status
          ORDER BY c.campaign_type, k.keyword_status
        `);
        
        // 9. 最近7天每天的优化事件数量
        const dailyEvents = await db_.execute(sql`
          SELECT DATE(created_at) as event_date, COUNT(*) as cnt, 
            SUM(CASE WHEN api_sync_status = 'synced' THEN 1 ELSE 0 END) as synced
          FROM optimization_events 
          WHERE event_category = 'bid_adjustment' 
            AND account_id = ${input.accountId}
            AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
          GROUP BY DATE(created_at)
          ORDER BY event_date DESC
        `);
        
        return {
          optimizationEvents: (eventsCount as unknown[][])[0]?.[0] || {},
          optimizationLogs: (logsCount as unknown[][])[0]?.[0] || {},
          deletedKeywords: (deletedKeywords as unknown[][])[0]?.[0] || {},
          sbKeywordStatus: (sbKeywordStatus as unknown[][])[0] || [],
          tasksStatus: (tasksStatus as unknown[][])[0] || [],
          recentEvents: (recentEvents as unknown[][])[0] || [],
          sbCampaignStats: (sbCampaignStats as unknown[][])[0]?.[0] || {},
          campaignTypeKeywords: (campaignTypeKeywords as unknown[][])[0] || [],
          dailyEvents: (dailyEvents as unknown[][])[0] || [],
        };
      } catch (err: unknown) {
        log.warn('[diagnostics] 查询失败:', (err as Error).message);
        return { error: (err as Error).message };
      }
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
